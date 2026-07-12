//! SQLite tables owned by apex-lang: `meta`, `apex_types`, `apex_members`,
//! `raw_cache`, `apex_fts`. Shares the org's unified `index.db` file (and the
//! `sqlite::open` opener) with sf-schema's `objects`/`fields` tables.

use rusqlite::{params, Connection};
use std::path::Path;

/// On-disk index schema version. Bump whenever EITHER crate's stored schema
/// changes (apex-lang's `meta`/`apex_*` or sf-schema's `objects`/`fields`/`fts`)
/// — one `index.db`, one shared version. The read path rejects a mismatched
/// index (forcing a reindex); a full reindex rebuilds every table fresh, so a
/// derived cache is never ALTERed or data-migrated.
pub const SCHEMA_VERSION: i64 = 3;

/// Create apex-lang's tables if absent.
pub fn ensure_apex_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
          id INTEGER PRIMARY KEY CHECK (id=1),
          schema_version INTEGER NOT NULL, alias TEXT NOT NULL, org_id TEXT NOT NULL,
          api_version TEXT NOT NULL, indexed_at TEXT NOT NULL, generation INTEGER NOT NULL,
          namespaces INTEGER NOT NULL, classes INTEGER NOT NULL, sobjects INTEGER NOT NULL,
          stdlib_error TEXT
        );
        CREATE TABLE IF NOT EXISTS apex_types (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL, kind TEXT NOT NULL,
          namespace TEXT,
          parent_class TEXT, interfaces TEXT NOT NULL, enum_values TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS apex_members (
          type_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL, type_text TEXT NOT NULL,
          params TEXT NOT NULL, is_static INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_apex_members_type ON apex_members(type_id);
        CREATE TABLE IF NOT EXISTS raw_cache (
          api_version TEXT NOT NULL, source TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (api_version, source)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS apex_fts USING fts5(type_name);
        ",
    )
}

/// Open the shared `index.db` (via sf-schema's opener, which also ensures its
/// own tables — harmless here) and ensure apex-lang's tables exist.
pub fn open_apex(path: &Path) -> rusqlite::Result<Connection> {
    let conn = sf_schema::sqlite::open(path)?;
    ensure_apex_schema(&conn)?;
    Ok(conn)
}

/// Read a cached raw JSON body for `(api_version, source)`, if present.
pub fn read_raw(conn: &Connection, api_version: &str, source: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT body FROM raw_cache WHERE api_version = ?1 AND source = ?2",
        params![api_version, source],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        e => Err(e),
    })
}

/// Upsert a raw JSON body for `(api_version, source)`.
pub fn write_raw(conn: &Connection, api_version: &str, source: &str, body: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO raw_cache (api_version, source, body) VALUES (?1, ?2, ?3)
         ON CONFLICT(api_version, source) DO UPDATE SET body = excluded.body",
        params![api_version, source, body],
    )?;
    Ok(())
}

/// Delete a cached raw body for `(api_version, source)`.
pub fn delete_raw(conn: &Connection, api_version: &str, source: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM raw_cache WHERE api_version = ?1 AND source = ?2",
        params![api_version, source],
    )?;
    Ok(())
}

/// The `meta` row: index provenance + counts + the fail-loud `stdlib_error`.
/// Read cheaply on every MCP tool call to stamp the org + snapshot freshness.
#[derive(Clone, Debug, PartialEq)]
pub struct Meta {
    pub schema_version: i64,
    pub alias: String,
    pub org_id: String,
    pub api_version: String,
    pub indexed_at: String,
    pub generation: i64,
    pub namespaces: i64,
    pub classes: i64,
    pub sobjects: i64,
    pub stdlib_error: Option<String>,
}

/// Read the single `meta` row, or `None` if the index is empty/uninitialized.
pub fn read_meta(conn: &Connection) -> rusqlite::Result<Option<Meta>> {
    conn.query_row(
        "SELECT schema_version, alias, org_id, api_version, indexed_at, generation,
                namespaces, classes, sobjects, stdlib_error
         FROM meta WHERE id = 1",
        [],
        |row| {
            Ok(Meta {
                schema_version: row.get(0)?,
                alias: row.get(1)?,
                org_id: row.get(2)?,
                api_version: row.get(3)?,
                indexed_at: row.get(4)?,
                generation: row.get(5)?,
                namespaces: row.get(6)?,
                classes: row.get(7)?,
                sobjects: row.get(8)?,
                stdlib_error: row.get(9)?,
            })
        },
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        e => Err(e),
    })
}

/// Whether the index at `path` matches the shared [`SCHEMA_VERSION`]. `false`
/// when the file or its `meta` row is absent/unreadable, or its stored version
/// differs. Reusable stale-guard for readers that open the shared `index.db`
/// directly (schema browse) instead of going through uf-ost's `Snapshot` — it
/// must fire BEFORE any SELECT that could touch an older column set (e.g. a v2
/// `fields` table without `inline_help_text`).
pub fn index_matches_version(path: &Path) -> bool {
    let Ok(conn) = sf_schema::sqlite::open_readonly(path) else {
        return false;
    };
    matches!(read_meta(&conn), Ok(Some(meta)) if meta.schema_version == SCHEMA_VERSION)
}

/// FTS5 fuzzy match over Apex type names. `query` is a raw FTS5 MATCH
/// expression (the caller tokenizes user input). Returns matching type names.
pub fn search_apex(conn: &Connection, query: &str, limit: usize) -> rusqlite::Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT type_name FROM apex_fts WHERE apex_fts MATCH ?1 LIMIT ?2")?;
    let rows = stmt.query_map(params![query, limit as i64], |row| row.get(0))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("apex-db-guard-{}-{nanos}/index.db", std::process::id()))
    }

    /// Insert a `meta` row at an arbitrary `schema_version` (all NOT NULL cols).
    fn seed_meta(conn: &Connection, version: i64) {
        conn.execute(
            "INSERT INTO meta (id, schema_version, alias, org_id, api_version,
                indexed_at, generation, namespaces, classes, sobjects)
             VALUES (1, ?1, 'MyOrg', '00Dorg', '60.0', '2020-01-01T00:00:00Z', 1, 0, 0, 0)",
            params![version],
        )
        .unwrap();
    }

    /// Regression: an index left at `schema_version = 2` — the shape before the
    /// `inline_help_text` column existed — must be rejected by the shared
    /// version guard, so schema-browse readers surface the "no-index" empty
    /// state instead of blowing up with `no such column: inline_help_text` the
    /// moment `read_fields` runs against the stale table.
    #[test]
    fn stale_v2_index_fails_version_guard() {
        let path = temp_db();

        // Build an index.db whose meta says v2 (guard must reject before any
        // reader SELECTs a v3-only column off the stale tables).
        {
            let conn = open_apex(&path).unwrap();
            seed_meta(&conn, 2);
        }
        assert!(
            !index_matches_version(&path),
            "a v2 index must be rejected as stale, not read as if current"
        );

        // Same file bumped to the current version now passes the guard.
        {
            let conn = open_apex(&path).unwrap();
            conn.execute("UPDATE meta SET schema_version = ?1", params![SCHEMA_VERSION])
                .unwrap();
        }
        assert!(
            index_matches_version(&path),
            "a current-version index passes the guard"
        );

        // A missing file is rejected too (never panics).
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
        assert!(!index_matches_version(&path), "missing index → rejected");
    }
}
