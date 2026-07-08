//! Invocation telemetry: every MCP tool call lands in `<root>/telemetry.db`
//! (NOT index.db — that file is rebuilt by the schema-version guard).
//! Open-per-call; logging failures never propagate to the tool result.

use rusqlite::Connection;
use std::path::PathBuf;

const MAX_PARAMS: usize = 512;
const MAX_DB_BYTES: u64 = 50 * 1024 * 1024;

pub struct Telemetry {
    root: PathBuf,
}

pub struct LogEntry<'a> {
    pub tool: &'a str,
    pub org: Option<&'a str>,
    pub params: &'a str,
    pub outcome: &'a str, // "ok" | "error"
    pub error: Option<&'a str>,
    pub duration_ms: u64,
}

impl Telemetry {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn open(&self) -> rusqlite::Result<Connection> {
        let conn = Connection::open(self.root.join("telemetry.db"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tool_log (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL DEFAULT (datetime('now')),
                tool TEXT NOT NULL,
                org TEXT,
                params TEXT,
                outcome TEXT NOT NULL,
                error TEXT,
                duration_ms INTEGER
            );
            CREATE TABLE IF NOT EXISTS org_meta (
                org TEXT PRIMARY KEY,
                is_sandbox INTEGER NOT NULL,
                checked_at TEXT NOT NULL
            );",
        )?;
        Ok(conn)
    }

    pub fn log(&self, e: LogEntry) {
        let res = (|| -> rusqlite::Result<()> {
            let conn = self.open()?;
            let params: String = e.params.chars().take(MAX_PARAMS).collect();
            conn.execute(
                "INSERT INTO tool_log (tool, org, params, outcome, error, duration_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![e.tool, e.org, params, e.outcome, e.error, e.duration_ms],
            )?;
            self.rotate(&conn);
            Ok(())
        })();
        if let Err(err) = res {
            eprintln!("uf-ost telemetry: {err}");
        }
    }

    /// ponytail: size check every insert is one fstat; trim oldest half when
    /// the file crosses 50MB. Upgrade to periodic vacuum if it ever matters.
    fn rotate(&self, conn: &Connection) {
        let size = std::fs::metadata(self.root.join("telemetry.db"))
            .map(|m| m.len())
            .unwrap_or(0);
        if size > MAX_DB_BYTES {
            let _ = conn.execute(
                "DELETE FROM tool_log WHERE id <= (SELECT id FROM tool_log ORDER BY id DESC LIMIT 1 OFFSET (SELECT count(*)/2 FROM tool_log))",
                [],
            );
            let _ = conn.execute_batch("VACUUM;");
        }
    }

    /// None = never checked. Some(true) = sandbox, Some(false) = production.
    pub fn get_org_meta(&self, org: &str) -> Option<bool> {
        let conn = self.open().ok()?;
        conn.query_row(
            "SELECT is_sandbox FROM org_meta WHERE org = ?1",
            [org],
            |r| r.get::<_, i64>(0),
        )
        .ok()
        .map(|v| v != 0)
    }

    pub fn set_org_meta(&self, org: &str, is_sandbox: bool) {
        if let Ok(conn) = self.open() {
            let _ = conn.execute(
                "INSERT INTO org_meta (org, is_sandbox, checked_at) VALUES (?1, ?2, datetime('now'))
                 ON CONFLICT(org) DO UPDATE SET is_sandbox = ?2, checked_at = datetime('now')",
                rusqlite::params![org, is_sandbox as i64],
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_and_reads_back() {
        let dir = std::env::temp_dir().join(format!("uf-tel-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let t = Telemetry::new(dir.clone());
        t.log(LogEntry {
            tool: "soql_query",
            org: Some("SFDC_Staging"),
            params: "{\"query\":\"SELECT Id FROM Account\"}",
            outcome: "ok",
            error: None,
            duration_ms: 42,
        });
        let conn = rusqlite::Connection::open(dir.join("telemetry.db")).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM tool_log WHERE tool='soql_query' AND outcome='ok'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn org_meta_roundtrip_and_params_truncation() {
        let dir = std::env::temp_dir().join(format!("uf-tel2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let t = Telemetry::new(dir.clone());
        assert_eq!(t.get_org_meta("X"), None);
        t.set_org_meta("X", false);
        assert_eq!(t.get_org_meta("X"), Some(false));

        let long = "q".repeat(2000);
        t.log(LogEntry { tool: "t", org: None, params: &long, outcome: "error", error: Some("boom"), duration_ms: 1 });
        let conn = rusqlite::Connection::open(dir.join("telemetry.db")).unwrap();
        let p: String = conn.query_row("SELECT params FROM tool_log", [], |r| r.get(0)).unwrap();
        assert!(p.len() <= 512);
        std::fs::remove_dir_all(&dir).ok();
    }
}
