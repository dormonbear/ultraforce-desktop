# Live-Org MCP Tools (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live-org MCP tools (`soql_query`, `record_get/create/update/delete`, `apex_run`, `rest_request`) to the `uf-ost` server, with offline pre-validation, production confirm rails, and full-invocation telemetry.

**Architecture:** New `live/` module family inside `crates/uf-ost` holds the tool logic; reusable REST DML helpers go in `crates/features/src/rest_dml.rs` (same layer as `soql::run_query_rest`). Auth reuses `sf_core::OrgRegistry::auth_info` (cached in-memory). Telemetry is a separate SQLite file `<root>/telemetry.db` — never `index.db` (schema-version guard rebuilds that). Prod detection queries `Organization.IsSandbox` once per org and caches it; failure ⇒ treated as prod.

**Tech Stack:** Rust, rmcp `=2.1.0` (pinned — pre-stable API), rusqlite, reqwest (already a `features` dep), tokio.

**Spec:** `docs/superpowers/prds/2026-07-08-uf-live-org-mcp.md` (8 locked decisions). Deploy gate (`deploy_precheck`/`deploy`) is **Plan 2** — a separate plan written after this one lands.

## Global Constraints

- rmcp pinned `=2.1.0`; params via `Parameters<T>` + `schemars::JsonSchema`; errors via `ErrorData` (invalid_params for caller mistakes, internal_error for ours).
- All serialized output structs: `#[serde(rename_all = "camelCase")]`. Multi-word tool params likewise camelCase (`skipValidation`).
- 800-line cap per file (`scripts/check-arch.sh` enforces). `server.rs` is at 382 — new tool registrations keep it under; logic lives in `live/*`, not in `server.rs`.
- Prod safety fail-safe: if `IsSandbox` cannot be determined, the org **is** prod until proven otherwise.
- Validation gate blocks only **definite** errors (object known in index, field/relationship not found). Unknown object or unindexed org ⇒ pass through to live. Every block message names the two escapes: `ost_sync` and `skipValidation: true`.
- Tests: `cargo test -p uf-ost` / `cargo test -p features`. Commit after every task. Conventional commits, no attribution lines.
- Never log the access token anywhere (telemetry params summary must come from tool args only, pre-auth).

---

### Task 1: Structured SOQL verdict (refactor `soql.rs`)

The live query tool needs a machine-readable verdict, not `soql_check`'s text blob. Extract the existing logic into `verdict()`; `soql_check` becomes a formatter over it. Existing tests must keep passing unchanged.

**Files:**
- Modify: `crates/uf-ost/src/soql.rs`

**Interfaces:**
- Produces: `pub struct Verdict { pub object_known: bool, pub errors: Vec<(usize, String)> }` and `pub fn verdict(snap: &Snapshot, query: &str) -> Result<Verdict, QueryError>`. `object_known == false` covers both "no FROM" and "FROM object not in index". Task 5 consumes this.

- [ ] **Step 1: Write the failing test** (append to the existing `tests` module in `soql.rs`; note existing tests there exercise `check_select` with in-memory schemas — `verdict` needs a `Snapshot`, so test it at the same level `soql_check` would be tested. If no snapshot fixture helper exists in the crate, test via the pure split instead: extract the body into `fn verdict_from(root, resolve, outline) -> Verdict` operating on the preloaded map, and test THAT with the in-memory schemas already used by `check_select` tests.)

```rust
#[test]
fn verdict_reports_object_known_and_errors() {
    // reuse the `field`/`lookup` helpers + Account/User map from the test above
    let user = SObjectSchema {
        name: "User".into(),
        fields: vec![field("Email", "email")],
        ..Default::default()
    };
    let account = SObjectSchema {
        name: "Account".into(),
        fields: vec![field("Name", "string"), lookup("OwnerId", "Owner", "User")],
        ..Default::default()
    };
    let mut map = HashMap::new();
    map.insert("User".to_string(), user);
    map.insert("Account".to_string(), account);

    let v = verdict_over(&map, "Account", "SELECT Naem FROM Account");
    assert!(v.object_known);
    assert_eq!(v.errors.len(), 1);
    assert!(v.errors[0].1.contains("did you mean 'Name'"));

    let ok = verdict_over(&map, "Account", "SELECT Name, Owner.Email FROM Account");
    assert!(ok.object_known && ok.errors.is_empty());
}
```

where `verdict_over` is a small test helper calling the extracted pure core with `outline(query)` + the map.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p uf-ost verdict_reports -- --nocapture`
Expected: FAIL — `verdict_over` / `Verdict` not defined.

- [ ] **Step 3: Implement.** Split `soql_check` into three layers:

```rust
#[derive(Debug)]
pub struct Verdict {
    /// FROM object resolved in the index. False ⇒ caller must NOT block on it.
    pub object_known: bool,
    /// (column, message) definite errors, sorted by column.
    pub errors: Vec<(usize, String)>,
}

/// Structured validation. Same schema-graph preload as before, then delegates
/// to the pure core so tests don't need a Snapshot.
pub fn verdict(snap: &Snapshot, query: &str) -> Result<Verdict, QueryError> {
    let o = outline(query);
    let Some(from) = o.from_object.as_deref() else {
        return Ok(Verdict { object_known: false, errors: vec![] });
    };
    let Some(root) = sqlite::read_object(snap.conn(), from)? else {
        return Ok(Verdict { object_known: false, errors: vec![] });
    };
    // ... existing preload loop building `map` (move verbatim from soql_check) ...
    Ok(verdict_core(&map, &from_key, &o, query))
}

/// Pure core over a preloaded schema map — the existing per-field loop +
/// `diagnostics` merge from soql_check, returning (col, msg) pairs.
fn verdict_core(
    map: &HashMap<String, SObjectSchema>,
    from_key: &str,
    o: &soql_lang::Outline,
    query: &str,
) -> Verdict { /* existing diags loop, returns Verdict { object_known: true, errors: diags } */ }
```

`soql_check` keeps its exact current output (header + `OK —` / `ERROR col N:` lines) but is reimplemented as a formatter over `verdict()`. The "Unknown object '{from}'" and "No FROM clause" texts stay in `soql_check` (formatter concern). Check the actual name/shape of `outline()`'s return type in `crates/soql-lang` before writing `verdict_core`'s signature — mirror whatever `soql_check` already destructures.

- [ ] **Step 4: Run the full crate test suite**

Run: `cargo test -p uf-ost`
Expected: PASS — including the pre-existing `check_select_flags_fields_and_relationships_with_suggestions` and any `soql_check` output tests.

- [ ] **Step 5: Commit**

```bash
git add crates/uf-ost/src/soql.rs
git commit -m "refactor(uf-ost): extract structured Verdict from soql_check"
```

---

### Task 2: Telemetry store

**Files:**
- Create: `crates/uf-ost/src/telemetry.rs`
- Modify: `crates/uf-ost/src/main.rs` (add `mod telemetry;`)

**Interfaces:**
- Produces:
  - `pub struct Telemetry { root: PathBuf }` — `Telemetry::new(root: PathBuf) -> Self` (no connection held; open-per-call, SQLite open is µs and this keeps the struct `Send + Sync` with zero locking).
  - `pub fn log(&self, e: LogEntry)` — never fails outward (telemetry must not break a tool; swallow + eprintln on error).
  - `pub struct LogEntry<'a> { pub tool: &'a str, pub org: Option<&'a str>, pub params: &'a str, pub outcome: &'a str, pub error: Option<&'a str>, pub duration_ms: u64 }`
  - `pub fn get_org_meta(&self, org: &str) -> Option<bool>` / `pub fn set_org_meta(&self, org: &str, is_sandbox: bool)` — the prod-detection cache (Task 3 consumes).
  - DB file: `<root>/telemetry.db`.

- [ ] **Step 1: Write the failing test**

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p uf-ost telemetry`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```rust
//! Invocation telemetry: every MCP tool call lands in `<root>/telemetry.db`
//! (NOT index.db — that file is rebuilt by the schema-version guard).
//! Open-per-call; logging failures never propagate to the tool result.

use std::path::PathBuf;
use rusqlite::Connection;

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
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p uf-ost telemetry`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/uf-ost/src/telemetry.rs crates/uf-ost/src/main.rs
git commit -m "feat(uf-ost): telemetry store — tool_log + org prod-detection cache"
```

---

### Task 3: REST DML helpers in `features`

**Files:**
- Create: `crates/features/src/rest_dml.rs`
- Modify: `crates/features/src/lib.rs` (add `pub mod rest_dml;` — match how `soql`/`anon_apex` are declared there)

**Interfaces:**
- Consumes: `sf_core::AuthInfo { access_token, instance_url, api_version }`.
- Produces (all return `Result<_, SfError>`):
  - `pub async fn record_get(auth: &AuthInfo, object: &str, id: &str) -> Result<serde_json::Value, SfError>`
  - `pub async fn record_create(auth: &AuthInfo, object: &str, fields: &serde_json::Value) -> Result<String, SfError>` (returns new id)
  - `pub async fn record_update(auth: &AuthInfo, object: &str, id: &str, fields: &serde_json::Value) -> Result<(), SfError>`
  - `pub async fn record_delete(auth: &AuthInfo, object: &str, id: &str) -> Result<(), SfError>`
  - `pub async fn rest_request(auth: &AuthInfo, method: &str, path: &str, body: Option<&serde_json::Value>) -> Result<(u16, serde_json::Value), SfError>`
  - `pub(crate) fn map_rest_error(status: u16, body: &str) -> SfError` — pure, tested.

- [ ] **Step 1: Write the failing tests** (pure functions only — the HTTP calls are thin wrappers, same policy as `run_query_rest` whose testing lives in the injected-fetcher `paginate`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_salesforce_error_array() {
        // Salesforce REST errors are a JSON array of {message, errorCode}
        let e = map_rest_error(400, r#"[{"message":"No such column 'Foo'","errorCode":"INVALID_FIELD"}]"#);
        let msg = e.to_string();
        assert!(msg.contains("INVALID_FIELD") && msg.contains("No such column"), "{msg}");
    }

    #[test]
    fn maps_non_json_error_body() {
        let e = map_rest_error(502, "<html>Bad Gateway</html>");
        assert!(e.to_string().contains("502"));
    }

    #[test]
    fn builds_sobject_url() {
        let auth = sf_core::AuthInfo {
            access_token: "t".into(),
            instance_url: "https://x.my.salesforce.com/".into(),
            api_version: Some("62.0".into()),
        };
        assert_eq!(
            sobject_url(&auth, "Account", Some("001xx")),
            "https://x.my.salesforce.com/services/data/v62.0/sobjects/Account/001xx"
        );
        assert_eq!(
            sobject_url(&auth, "Account", None),
            "https://x.my.salesforce.com/services/data/v62.0/sobjects/Account"
        );
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p features rest_dml`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```rust
//! Single-record REST DML + a generic REST escape hatch. Same layer and auth
//! contract as `soql::run_query_rest`: caller supplies a fresh `AuthInfo`.

use sf_core::{AuthInfo, SfError};

fn base(auth: &AuthInfo) -> String {
    let api = auth.api_version.as_deref().unwrap_or("62.0");
    format!(
        "{}/services/data/v{api}",
        auth.instance_url.trim_end_matches('/')
    )
}

fn sobject_url(auth: &AuthInfo, object: &str, id: Option<&str>) -> String {
    match id {
        Some(id) => format!("{}/sobjects/{object}/{id}", base(auth)),
        None => format!("{}/sobjects/{object}", base(auth)),
    }
}

/// Salesforce REST errors arrive as `[{"message","errorCode"}]`; surface both.
fn map_rest_error(status: u16, body: &str) -> SfError {
    #[derive(serde::Deserialize)]
    struct RestErr {
        message: String,
        #[serde(rename = "errorCode")]
        error_code: String,
    }
    match serde_json::from_str::<Vec<RestErr>>(body) {
        Ok(errs) if !errs.is_empty() => SfError::Unexpected(
            errs.iter()
                .map(|e| format!("{}: {}", e.error_code, e.message))
                .collect::<Vec<_>>()
                .join("; "),
        ),
        _ => SfError::Unexpected(format!("HTTP {status}: {}", body.chars().take(500).collect::<String>())),
    }
}

async fn send(
    auth: &AuthInfo,
    method: reqwest::Method,
    url: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, String), SfError> {
    let client = reqwest::Client::new();
    let mut req = client
        .request(method, url)
        .bearer_auth(&auth.access_token)
        .header("Content-Type", "application/json");
    if let Some(b) = body {
        req = req.json(b);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| SfError::Unexpected(format!("request failed: {e}")))?;
    let status = resp.status().as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| SfError::Unexpected(format!("read body failed: {e}")))?;
    Ok((status, text))
}

pub async fn record_get(auth: &AuthInfo, object: &str, id: &str) -> Result<serde_json::Value, SfError> {
    let (status, body) = send(auth, reqwest::Method::GET, &sobject_url(auth, object, Some(id)), None).await?;
    if status >= 300 {
        return Err(map_rest_error(status, &body));
    }
    serde_json::from_str(&body).map_err(SfError::Parse)
}

pub async fn record_create(auth: &AuthInfo, object: &str, fields: &serde_json::Value) -> Result<String, SfError> {
    let (status, body) = send(auth, reqwest::Method::POST, &sobject_url(auth, object, None), Some(fields)).await?;
    if status >= 300 {
        return Err(map_rest_error(status, &body));
    }
    let v: serde_json::Value = serde_json::from_str(&body).map_err(SfError::Parse)?;
    v.get("id")
        .and_then(|i| i.as_str())
        .map(String::from)
        .ok_or_else(|| SfError::Unexpected(format!("create response missing id: {body}")))
}

pub async fn record_update(auth: &AuthInfo, object: &str, id: &str, fields: &serde_json::Value) -> Result<(), SfError> {
    let (status, body) = send(auth, reqwest::Method::PATCH, &sobject_url(auth, object, Some(id)), Some(fields)).await?;
    if status >= 300 {
        return Err(map_rest_error(status, &body));
    }
    Ok(())
}

pub async fn record_delete(auth: &AuthInfo, object: &str, id: &str) -> Result<(), SfError> {
    let (status, body) = send(auth, reqwest::Method::DELETE, &sobject_url(auth, object, Some(id)), None).await?;
    if status >= 300 {
        return Err(map_rest_error(status, &body));
    }
    Ok(())
}

/// Generic escape hatch. `path` must already start with `/services/` (the
/// caller validates); returns (status, parsed-or-string body).
pub async fn rest_request(
    auth: &AuthInfo,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, serde_json::Value), SfError> {
    let m: reqwest::Method = method
        .parse()
        .map_err(|_| SfError::Unexpected(format!("bad method {method}")))?;
    let url = format!("{}{}", auth.instance_url.trim_end_matches('/'), path);
    let (status, text) = send(auth, m, &url, body).await?;
    let parsed = serde_json::from_str(&text)
        .unwrap_or_else(|_| serde_json::Value::String(text.chars().take(20_000).collect()));
    Ok((status, parsed))
}
```

Check `SfError`'s actual variants in `crates/sf-core/src/error.rs` first — if there's a more fitting variant than `Unexpected` (e.g. a `Command`/`Http` variant), use it; keep `Parse` for serde failures as `run_query_rest` does.

- [ ] **Step 4: Run tests**

Run: `cargo test -p features rest_dml`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/rest_dml.rs crates/features/src/lib.rs
git commit -m "feat(features): single-record REST DML + generic rest_request helper"
```

---

### Task 4: LiveCtx — auth cache, prod detection, confirm gate

**Files:**
- Create: `crates/uf-ost/src/live/mod.rs`
- Modify: `crates/uf-ost/src/main.rs` (add `mod live;`)

**Interfaces:**
- Consumes: `Telemetry::{get_org_meta, set_org_meta}` (Task 2), `sf_core::{SfInvoker, ProcessRunner, OrgRegistry, AuthInfo}`, `features::soql::{run_query_rest, QueryOptions}`.
- Produces:
  - `pub struct LiveCtx { auth: tokio::sync::Mutex<HashMap<String, (AuthInfo, Instant)>>, pub telemetry: Telemetry }`, `LiveCtx::new(root: PathBuf) -> Self`.
  - `pub async fn auth(&self, org: &str) -> Result<AuthInfo, ErrorData>` — cached 15 min; `sf org display` re-fetch after TTL (it returns a refreshed token).
  - `pub fn drop_auth(&self, org: &str)` — called by tools on `INVALID_SESSION_ID` errors so the next call re-fetches.
  - `pub async fn is_prod(&self, org: &str) -> bool` — cache hit ⇒ answer; miss ⇒ live `SELECT IsSandbox FROM Organization LIMIT 1`; **any failure ⇒ true (prod), uncached**.
  - `pub fn parse_is_sandbox(qr: &features::soql::QueryResult) -> Option<bool>` — pure, tested.
  - `pub fn gate_write(is_prod: bool, confirm: bool) -> Result<(), ErrorData>` — pure, tested.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use features::soql::{FieldValue, QueryResult, Record};

    fn qr(is_sandbox: bool) -> QueryResult {
        QueryResult {
            total_size: 1,
            done: true,
            records: vec![Record {
                sobject_type: "Organization".into(),
                fields: vec![(
                    "IsSandbox".into(),
                    FieldValue::Scalar(serde_json::Value::Bool(is_sandbox)),
                )],
            }],
        }
    }

    #[test]
    fn parses_is_sandbox() {
        assert_eq!(parse_is_sandbox(&qr(true)), Some(true));
        assert_eq!(parse_is_sandbox(&qr(false)), Some(false));
        let empty = QueryResult { total_size: 0, done: true, records: vec![] };
        assert_eq!(parse_is_sandbox(&empty), None);
    }

    #[test]
    fn gate_blocks_unconfirmed_prod_writes() {
        assert!(gate_write(false, false).is_ok()); // sandbox, no confirm needed
        assert!(gate_write(true, true).is_ok());   // prod, confirmed
        let err = gate_write(true, false).unwrap_err();
        assert!(err.message.contains("PRODUCTION"), "{}", err.message);
        assert!(err.message.contains("confirm"), "{}", err.message);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p uf-ost live::`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```rust
//! Live-org plumbing shared by all live tools: cached auth, prod detection
//! (fail-safe: unknown ⇒ prod), and the write-confirm gate.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use rmcp::ErrorData;
use sf_core::{AuthInfo, OrgRegistry, ProcessRunner, SfInvoker};

use crate::telemetry::Telemetry;

const AUTH_TTL: Duration = Duration::from_secs(15 * 60);

pub struct LiveCtx {
    auth: tokio::sync::Mutex<HashMap<String, (AuthInfo, Instant)>>,
    pub telemetry: Telemetry,
}

impl LiveCtx {
    pub fn new(root: PathBuf) -> Self {
        Self {
            auth: tokio::sync::Mutex::new(HashMap::new()),
            telemetry: Telemetry::new(root),
        }
    }

    /// Cached `sf org display` auth. TTL 15 min — `sf org display` refreshes
    /// the token, so a re-fetch is always valid.
    pub async fn auth(&self, org: &str) -> Result<AuthInfo, ErrorData> {
        let mut cache = self.auth.lock().await;
        if let Some((info, at)) = cache.get(org) {
            if at.elapsed() < AUTH_TTL {
                return Ok(info.clone());
            }
        }
        let invoker = SfInvoker::new(std::sync::Arc::new(ProcessRunner));
        let info = OrgRegistry::auth_info(&invoker, Some(org)).await.map_err(|e| {
            ErrorData::invalid_params(
                format!("cannot get auth for org '{org}': {e}. Is it authenticated in sf CLI?"),
                None,
            )
        })?;
        cache.insert(org.to_string(), (info.clone(), Instant::now()));
        Ok(info)
    }

    pub async fn drop_auth(&self, org: &str) {
        self.auth.lock().await.remove(org);
    }

    /// Fail-safe prod detection: cached `Organization.IsSandbox`, one live
    /// query on miss; any failure ⇒ treat as production, do NOT cache.
    pub async fn is_prod(&self, org: &str) -> bool {
        if let Some(is_sandbox) = self.telemetry.get_org_meta(org) {
            return !is_sandbox;
        }
        let Ok(auth) = self.auth(org).await else { return true };
        let cancel = AtomicBool::new(false);
        let res = features::soql::run_query_rest(
            &auth,
            "SELECT IsSandbox FROM Organization LIMIT 1",
            features::soql::QueryOptions::default(),
            &|_, _| {},
            &cancel,
        )
        .await;
        match res.ok().as_ref().and_then(parse_is_sandbox) {
            Some(is_sandbox) => {
                self.telemetry.set_org_meta(org, is_sandbox);
                !is_sandbox
            }
            None => true, // fail-safe: unknown ⇒ prod
        }
    }
}

pub fn parse_is_sandbox(qr: &features::soql::QueryResult) -> Option<bool> {
    let rec = qr.records.first()?;
    rec.fields.iter().find_map(|(name, v)| {
        (name.eq_ignore_ascii_case("IsSandbox")).then(|| match v {
            features::soql::FieldValue::Scalar(serde_json::Value::Bool(b)) => Some(*b),
            _ => None,
        })?
    })
}

/// The write-confirm rail. Every mutating tool calls this before touching the org.
pub fn gate_write(is_prod: bool, confirm: bool) -> Result<(), ErrorData> {
    if is_prod && !confirm {
        return Err(ErrorData::invalid_params(
            "This org is PRODUCTION (or its type could not be verified). Mutating it requires \
             explicit user approval: describe the change to the user, get their yes, then retry \
             with confirm: true."
                .to_string(),
            None,
        ));
    }
    Ok(())
}
```

Adjust `parse_is_sandbox` to the actual `FieldValue` variants (check `crates/features/src/soql.rs:29`) — `Scalar(serde_json::Value)` is correct per current source.

- [ ] **Step 4: Run tests**

Run: `cargo test -p uf-ost live::`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/uf-ost/src/live/mod.rs crates/uf-ost/src/main.rs
git commit -m "feat(uf-ost): LiveCtx — cached auth, fail-safe prod detection, write gate"
```

---

### Task 5: `soql_query` tool

**Files:**
- Create: `crates/uf-ost/src/live/query.rs`
- Modify: `crates/uf-ost/src/live/mod.rs` (add `pub mod query;`)
- Modify: `crates/uf-ost/src/server.rs` (hold `live: live::LiveCtx` on `OstServer`, register tool)

**Interfaces:**
- Consumes: `soql::verdict` (Task 1), `LiveCtx::auth` (Task 4), `features::soql::{run_query_rest, QueryOptions, QueryResult}`.
- Produces:
  - `pub struct SoqlResultDto` (camelCase): `{ org: String, total_size: u64, returned: usize, done: bool, columns: Vec<String>, rows: Vec<Vec<String>>, warning: Option<String> }`
  - `pub fn validation_block(v: &crate::soql::Verdict) -> Option<String>` — pure gate decision, tested.
  - `pub async fn soql_query(server_root: &Path, live: &LiveCtx, org: &str, query: &str, tooling: bool, all_rows: bool, limit: usize, skip_validation: bool) -> Result<SoqlResultDto, ErrorData>`

- [ ] **Step 1: Write the failing tests** (pure parts: gate decision + truncation shaping)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::soql::Verdict;

    #[test]
    fn blocks_only_definite_errors() {
        // unknown object ⇒ pass through (index may be stale / org unindexed)
        assert!(validation_block(&Verdict { object_known: false, errors: vec![] }).is_none());
        // known object, no errors ⇒ pass
        assert!(validation_block(&Verdict { object_known: true, errors: vec![] }).is_none());
        // known object + field errors ⇒ block, message names both escapes
        let msg = validation_block(&Verdict {
            object_known: true,
            errors: vec![(8, "Unknown field 'Naem' on Account — did you mean 'Name'?".into())],
        })
        .unwrap();
        assert!(msg.contains("did you mean 'Name'"));
        assert!(msg.contains("ost_sync") && msg.contains("skipValidation"), "{msg}");
    }

    #[test]
    fn shapes_result_with_truncation_warning() {
        let qr = features::soql::QueryResult { total_size: 500, done: false, records: vec![] };
        let dto = shape(&qr, "SFDC_Staging", 200);
        assert_eq!(dto.total_size, 500);
        assert!(!dto.done);
        let w = dto.warning.unwrap();
        assert!(w.contains("200") && w.contains("500"), "{w}");
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p uf-ost live::query`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
//! Live SOQL: offline pre-validation (block only definite errors), REST
//! execution with a row cap via the paginator's cancel flag, table-shaped DTO.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use rmcp::{schemars, ErrorData};
use serde::Serialize;

use crate::live::LiveCtx;
use crate::query as ost_query;
use crate::soql::{self, Verdict};

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SoqlResultDto {
    pub org: String,
    pub total_size: u64,
    pub returned: usize,
    pub done: bool,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub warning: Option<String>,
}

/// Block ONLY when the index positively knows the object and found errors.
pub fn validation_block(v: &Verdict) -> Option<String> {
    if !v.object_known || v.errors.is_empty() {
        return None;
    }
    let lines: Vec<String> = v.errors.iter().map(|(c, m)| format!("col {c}: {m}")).collect();
    Some(format!(
        "Offline validation failed (query NOT sent to the org):\n{}\n\
         If a field was added recently, run ost_sync first; to force execution pass skipValidation: true.",
        lines.join("\n")
    ))
}

fn shape(qr: &features::soql::QueryResult, org: &str, limit: usize) -> SoqlResultDto {
    let table = qr.to_table();
    let truncated = !qr.done;
    SoqlResultDto {
        org: org.to_string(),
        total_size: qr.total_size,
        returned: table.rows.len().min(limit),
        done: qr.done,
        columns: table.columns,
        rows: table.rows.into_iter().take(limit).collect(),
        warning: truncated.then(|| {
            format!(
                "Truncated at {limit} rows (totalSize={}). Refine the query (WHERE/LIMIT) or raise `limit`.",
                qr.total_size
            )
        }),
    }
}

pub async fn soql_query(
    root: &Path,
    live: &LiveCtx,
    org: &str,
    query: &str,
    tooling: bool,
    all_rows: bool,
    limit: usize,
    skip_validation: bool,
) -> Result<SoqlResultDto, ErrorData> {
    // 1. Offline pre-validation — free, local, blocks only definite errors.
    //    Tooling-API queries validate against Tooling objects we don't index ⇒ skip.
    if !skip_validation && !tooling {
        if let Ok(snap) = ost_query::open_org(root, org) {
            if let Ok(v) = soql::verdict(&snap, query) {
                if let Some(msg) = validation_block(&v) {
                    return Err(ErrorData::invalid_params(msg, None));
                }
            }
        } // unindexed org ⇒ pass through
    }

    // 2. Execute over REST with a row cap: flip the paginator's cancel flag
    //    once enough rows arrived (partial result comes back with done=false).
    let auth = live.auth(org).await?;
    let cancel = AtomicBool::new(false);
    let cap = limit as u64;
    let opts = features::soql::QueryOptions { use_tooling_api: tooling, all_rows };
    let res = features::soql::run_query_rest(
        &auth,
        query,
        opts,
        &|fetched, _| {
            if fetched >= cap {
                cancel.store(true, Ordering::Relaxed);
            }
        },
        &cancel,
    )
    .await;

    match res {
        Ok(qr) => Ok(shape(&qr, org, limit)),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("INVALID_SESSION_ID") {
                live.drop_auth(org).await;
            }
            // 3. Error enrichment: attach offline suggestions when the org
            //    rejected a field/column (agent skipped or beat validation).
            let hint = if msg.contains("INVALID_FIELD") || msg.contains("No such column") {
                "\nHint: use ost_object / ost_search to find the right field name."
            } else {
                ""
            };
            Err(ErrorData::invalid_params(format!("{msg}{hint}"), None))
        }
    }
}
```

Then in `server.rs`:
- Add field `live: live::LiveCtx` to `OstServer`; init in `new()` with `live::LiveCtx::new(root.clone())`.
- Add the arg struct + tool:

```rust
#[derive(Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SoqlQueryArgs {
    org: String,
    /// SOQL to execute against the live org (validated offline first).
    query: String,
    /// Query the Tooling API instead of the data API.
    tooling: Option<bool>,
    /// Include deleted/archived rows (queryAll).
    all_rows: Option<bool>,
    /// Max rows returned (default 200).
    limit: Option<usize>,
    /// Skip offline pre-validation (use after ost_sync disagrees with reality).
    skip_validation: Option<bool>,
}

#[tool(
    name = "soql_query",
    description = "Execute SOQL against the LIVE org. Validated offline first (typos blocked locally with did-you-mean, zero org round-trip); returns clean columns/rows JSON — no --json | jq pipelines. Default cap 200 rows."
)]
async fn soql_query(
    &self,
    Parameters(a): Parameters<SoqlQueryArgs>,
) -> Result<Json<live::query::SoqlResultDto>, ErrorData> {
    live::query::soql_query(
        &self.root,
        &self.live,
        &a.org,
        &a.query,
        a.tooling.unwrap_or(false),
        a.all_rows.unwrap_or(false),
        a.limit.unwrap_or(200),
        a.skip_validation.unwrap_or(false),
    )
    .await
    .map(Json)
}
```

- [ ] **Step 4: Run tests + build**

Run: `cargo test -p uf-ost && cargo check -p uf-ost`
Expected: PASS. (The `shape` truncation test, the gate test, and all pre-existing tests.)

- [ ] **Step 5: Manual smoke test against a real indexed org** (SFDC_Staging is indexed per repo docs)

Run: `cargo run -p uf-ost -- serve` is stdio — instead verify via the rmcp dev-dependency pattern or simplest: temporarily `cargo test` only, and do the live smoke in Task 9's checklist. Mark this step done after `cargo check` passes.

- [ ] **Step 6: Commit**

```bash
git add crates/uf-ost/src/live/query.rs crates/uf-ost/src/live/mod.rs crates/uf-ost/src/server.rs
git commit -m "feat(uf-ost): soql_query live tool — offline pre-validation + row cap"
```

---

### Task 6: Record CRUD tools

**Files:**
- Create: `crates/uf-ost/src/live/dml.rs`
- Modify: `crates/uf-ost/src/live/mod.rs` (add `pub mod dml;`)
- Modify: `crates/uf-ost/src/server.rs` (register 4 tools)

**Interfaces:**
- Consumes: `features::rest_dml::*` (Task 3), `LiveCtx::{auth, is_prod}`, `gate_write` (Task 4).
- Produces: `pub struct MutationDto { pub org: String, pub object: String, pub id: String, pub action: String }` (camelCase).

- [ ] **Step 1: Write the failing test** (the gate wiring is the testable seam; REST calls are thin)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_must_be_json_object() {
        let bad = serde_json::json!([1, 2]);
        assert!(validate_fields(&bad).is_err());
        let good = serde_json::json!({"Name": "Acme"});
        assert!(validate_fields(&good).is_ok());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p uf-ost live::dml`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
//! Single-record CRUD over REST, behind the prod confirm gate.

use rmcp::{schemars, ErrorData};
use serde::Serialize;

use crate::live::{gate_write, LiveCtx};

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MutationDto {
    pub org: String,
    pub object: String,
    pub id: String,
    pub action: String, // "created" | "updated" | "deleted"
}

pub fn validate_fields(fields: &serde_json::Value) -> Result<(), ErrorData> {
    if !fields.is_object() {
        return Err(ErrorData::invalid_params(
            "`fields` must be a JSON object of {FieldApiName: value}".to_string(),
            None,
        ));
    }
    Ok(())
}

pub async fn get(live: &LiveCtx, org: &str, object: &str, id: &str) -> Result<serde_json::Value, ErrorData> {
    let auth = live.auth(org).await?;
    features::rest_dml::record_get(&auth, object, id)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))
}

pub async fn create(
    live: &LiveCtx,
    org: &str,
    object: &str,
    fields: &serde_json::Value,
    confirm: bool,
) -> Result<MutationDto, ErrorData> {
    validate_fields(fields)?;
    gate_write(live.is_prod(org).await, confirm)?;
    let auth = live.auth(org).await?;
    let id = features::rest_dml::record_create(&auth, object, fields)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
    Ok(MutationDto { org: org.into(), object: object.into(), id, action: "created".into() })
}

pub async fn update(
    live: &LiveCtx,
    org: &str,
    object: &str,
    id: &str,
    fields: &serde_json::Value,
    confirm: bool,
) -> Result<MutationDto, ErrorData> {
    validate_fields(fields)?;
    gate_write(live.is_prod(org).await, confirm)?;
    let auth = live.auth(org).await?;
    features::rest_dml::record_update(&auth, object, id, fields)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
    Ok(MutationDto { org: org.into(), object: object.into(), id: id.into(), action: "updated".into() })
}

pub async fn delete(
    live: &LiveCtx,
    org: &str,
    object: &str,
    id: &str,
    confirm: bool,
) -> Result<MutationDto, ErrorData> {
    gate_write(live.is_prod(org).await, confirm)?;
    let auth = live.auth(org).await?;
    features::rest_dml::record_delete(&auth, object, id)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
    Ok(MutationDto { org: org.into(), object: object.into(), id: id.into(), action: "deleted".into() })
}
```

Server registrations (arg structs camelCase; descriptions must tell the agent the prod-confirm contract):

```rust
#[derive(Deserialize, schemars::JsonSchema)]
struct RecordGetArgs {
    org: String,
    object: String,
    id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RecordCreateArgs {
    org: String,
    object: String,
    /// {FieldApiName: value} JSON object.
    fields: serde_json::Value,
    /// Required true for production orgs, after the user approved the change.
    confirm: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RecordUpdateArgs {
    org: String,
    object: String,
    id: String,
    fields: serde_json::Value,
    confirm: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RecordDeleteArgs {
    org: String,
    object: String,
    id: String,
    confirm: Option<bool>,
}

#[tool(name = "record_get", description = "Fetch one record by Id from the LIVE org (all fields). Replaces `sf data get record`.")]
async fn record_get(&self, Parameters(a): Parameters<RecordGetArgs>) -> Result<Json<serde_json::Value>, ErrorData> {
    live::dml::get(&self.live, &a.org, &a.object, &a.id).await.map(Json)
}

#[tool(name = "record_create", description = "Create ONE record in the LIVE org. Production orgs refuse without confirm:true (get user approval first).")]
async fn record_create(&self, Parameters(a): Parameters<RecordCreateArgs>) -> Result<Json<live::dml::MutationDto>, ErrorData> {
    live::dml::create(&self.live, &a.org, &a.object, &a.fields, a.confirm.unwrap_or(false)).await.map(Json)
}

#[tool(name = "record_update", description = "Update ONE record by Id in the LIVE org. Production orgs refuse without confirm:true (get user approval first).")]
async fn record_update(&self, Parameters(a): Parameters<RecordUpdateArgs>) -> Result<Json<live::dml::MutationDto>, ErrorData> {
    live::dml::update(&self.live, &a.org, &a.object, &a.id, &a.fields, a.confirm.unwrap_or(false)).await.map(Json)
}

#[tool(name = "record_delete", description = "Delete ONE record by Id in the LIVE org. Production orgs refuse without confirm:true (get user approval first).")]
async fn record_delete(&self, Parameters(a): Parameters<RecordDeleteArgs>) -> Result<Json<live::dml::MutationDto>, ErrorData> {
    live::dml::delete(&self.live, &a.org, &a.object, &a.id, a.confirm.unwrap_or(false)).await.map(Json)
}
```

(If `serde_json::Value` fails to derive a schema through `Parameters`, fall back to `fields: std::collections::HashMap<String, serde_json::Value>` — schemars handles maps.)

- [ ] **Step 4: Run tests + build**

Run: `cargo test -p uf-ost && cargo check -p uf-ost`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/uf-ost/src/live/dml.rs crates/uf-ost/src/live/mod.rs crates/uf-ost/src/server.rs
git commit -m "feat(uf-ost): record CRUD live tools behind prod confirm gate"
```

---

### Task 7: `apex_run` tool

**Files:**
- Create: `crates/uf-ost/src/live/apex.rs`
- Modify: `crates/uf-ost/src/live/mod.rs` (add `pub mod apex;`)
- Modify: `crates/uf-ost/src/server.rs` (register tool)

**Interfaces:**
- Consumes: `features::anon_apex::{run_anon, AnonApexOutcome, ApexRunResult}` (shells `sf apex run` via a temp file — no 2-min Bash ceiling here; set `SfInvoker::with_timeout(Duration::from_secs(300))`), `gate_write`, `LiveCtx::is_prod`.
- Produces: `pub struct ApexRunDto` (camelCase): `{ org, compiled: bool, success: bool, compile_problem: Option<String>, exception_message: Option<String>, exception_stack_trace: Option<String>, line: Option<i64>, column: Option<i64>, debug: Vec<String>, log_truncated: bool }`.
- `pub fn extract_debug(logs: &str, cap: usize) -> (Vec<String>, bool)` — pure, tested.

- [ ] **Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_user_debug_and_exception_lines() {
        let log = "\
09:00:00.1 (1)|EXECUTION_STARTED
09:00:00.2 (2)|USER_DEBUG|[1]|DEBUG|hello
09:00:00.3 (3)|SOQL_EXECUTE_BEGIN|[2]|SELECT Id FROM Account
09:00:00.4 (4)|EXCEPTION_THROWN|[3]|System.NullPointerException
09:00:00.5 (5)|FATAL_ERROR|System.NullPointerException: boom
09:00:00.6 (6)|EXECUTION_FINISHED";
        let (lines, truncated) = extract_debug(log, 200);
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("hello"));
        assert!(lines[1].contains("EXCEPTION_THROWN"));
        assert!(lines[2].contains("FATAL_ERROR"));
        assert!(!truncated);
    }

    #[test]
    fn caps_line_count() {
        let log = (0..500)
            .map(|i| format!("t ({i})|USER_DEBUG|[1]|DEBUG|line{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let (lines, truncated) = extract_debug(&log, 200);
        assert_eq!(lines.len(), 200);
        assert!(truncated);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p uf-ost live::apex`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
//! Anonymous Apex over `sf apex run` (via features::anon_apex), prod-gated,
//! with the debug log distilled to USER_DEBUG/EXCEPTION/FATAL lines.

use std::time::Duration;

use rmcp::{schemars, ErrorData};
use serde::Serialize;

use crate::live::{gate_write, LiveCtx};

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApexRunDto {
    pub org: String,
    pub compiled: bool,
    pub success: bool,
    pub compile_problem: Option<String>,
    pub exception_message: Option<String>,
    pub exception_stack_trace: Option<String>,
    pub line: Option<i64>,
    pub column: Option<i64>,
    /// USER_DEBUG / EXCEPTION_THROWN / FATAL_ERROR lines from the debug log.
    pub debug: Vec<String>,
    pub log_truncated: bool,
}

const DEBUG_MARKERS: [&str; 3] = ["|USER_DEBUG|", "|EXCEPTION_THROWN|", "|FATAL_ERROR"];

pub fn extract_debug(logs: &str, cap: usize) -> (Vec<String>, bool) {
    let mut out = Vec::new();
    let mut truncated = false;
    for line in logs.lines() {
        if DEBUG_MARKERS.iter().any(|m| line.contains(m)) {
            if out.len() == cap {
                truncated = true;
                break;
            }
            out.push(line.to_string());
        }
    }
    (out, truncated)
}

pub async fn apex_run(
    live: &LiveCtx,
    org: &str,
    code: &str,
    confirm: bool,
) -> Result<ApexRunDto, ErrorData> {
    // Anonymous Apex can mutate anything — gate on prod like a write.
    gate_write(live.is_prod(org).await, confirm)?;

    let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(sf_core::ProcessRunner))
        .with_timeout(Duration::from_secs(300));
    let outcome = features::anon_apex::run_anon(&invoker, code, Some(org))
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;

    let r = outcome.result;
    let (debug, log_truncated) = extract_debug(&r.logs, 200);
    Ok(ApexRunDto {
        org: org.to_string(),
        compiled: r.compiled,
        success: r.success,
        compile_problem: r.compile_problem,
        exception_message: r.exception_message,
        exception_stack_trace: r.exception_stack_trace,
        line: r.line,
        column: r.column,
        debug,
        log_truncated,
    })
}
```

Server registration:

```rust
#[derive(Deserialize, schemars::JsonSchema)]
struct ApexRunArgs {
    org: String,
    /// Anonymous Apex source to execute.
    code: String,
    /// Required true for production orgs, after the user approved the change.
    confirm: Option<bool>,
}

#[tool(
    name = "apex_run",
    description = "Execute anonymous Apex in the LIVE org. Returns structured compile/runtime result + USER_DEBUG lines (no raw log dump). 5-min timeout. Production orgs refuse without confirm:true."
)]
async fn apex_run(&self, Parameters(a): Parameters<ApexRunArgs>) -> Result<Json<live::apex::ApexRunDto>, ErrorData> {
    live::apex::apex_run(&self.live, &a.org, &a.code, a.confirm.unwrap_or(false)).await.map(Json)
}
```

Compile-failure note: `run_anon` already returns compile failures as `Ok(outcome)` with `compiled=false` (the envelope parser handles non-zero exits) — do NOT convert those into `ErrorData`; the DTO carries them.

- [ ] **Step 4: Run tests + build**

Run: `cargo test -p uf-ost && cargo check -p uf-ost`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/uf-ost/src/live/apex.rs crates/uf-ost/src/live/mod.rs crates/uf-ost/src/server.rs
git commit -m "feat(uf-ost): apex_run live tool — structured result, distilled debug log"
```

---

### Task 8: `rest_request` escape hatch

**Files:**
- Create: `crates/uf-ost/src/live/rest.rs`
- Modify: `crates/uf-ost/src/live/mod.rs` (add `pub mod rest;`)
- Modify: `crates/uf-ost/src/server.rs` (register tool)

**Interfaces:**
- Consumes: `features::rest_dml::rest_request` (Task 3), `gate_write`, `LiveCtx`.
- Produces: `pub struct RestDto` (camelCase): `{ org: String, status: u16, body: serde_json::Value }`; `pub fn check_path_and_method(path: &str, method: &str) -> Result<bool /*is_write*/, ErrorData>` — pure, tested.

- [ ] **Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_path_and_classifies_writes() {
        assert_eq!(check_path_and_method("/services/data/v62.0/limits", "GET").unwrap(), false);
        assert_eq!(check_path_and_method("/services/data/v62.0/sobjects/Account", "POST").unwrap(), true);
        assert_eq!(check_path_and_method("/services/data/v62.0/x", "PATCH").unwrap(), true);
        assert_eq!(check_path_and_method("/services/data/v62.0/x", "DELETE").unwrap(), true);
        // non-/services/ path refused
        assert!(check_path_and_method("/secur/frontdoor.jsp", "GET").is_err());
        // unknown method refused
        assert!(check_path_and_method("/services/data/v62.0/x", "TRACE").is_err());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p uf-ost live::rest`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
//! Generic REST escape hatch — so an uncovered API never forces the agent
//! back to curl/CLI. Writes go through the same prod gate as DML.

use rmcp::{schemars, ErrorData};
use serde::Serialize;

use crate::live::{gate_write, LiveCtx};

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RestDto {
    pub org: String,
    pub status: u16,
    pub body: serde_json::Value,
}

/// Path must live under /services/ (REST, Tooling, Composite, Bulk); method
/// whitelist; returns whether this counts as a write (⇒ prod gate applies).
pub fn check_path_and_method(path: &str, method: &str) -> Result<bool, ErrorData> {
    if !path.starts_with("/services/") {
        return Err(ErrorData::invalid_params(
            format!("path must start with /services/ — got '{path}'"),
            None,
        ));
    }
    match method {
        "GET" => Ok(false),
        "POST" | "PATCH" | "PUT" | "DELETE" => Ok(true),
        other => Err(ErrorData::invalid_params(
            format!("unsupported method '{other}' (GET/POST/PATCH/PUT/DELETE)"),
            None,
        )),
    }
}

pub async fn rest(
    live: &LiveCtx,
    org: &str,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
    confirm: bool,
) -> Result<RestDto, ErrorData> {
    let is_write = check_path_and_method(path, method)?;
    if is_write {
        gate_write(live.is_prod(org).await, confirm)?;
    }
    let auth = live.auth(org).await?;
    let (status, parsed) = features::rest_dml::rest_request(&auth, method, path, body)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
    Ok(RestDto { org: org.to_string(), status, body: parsed })
}
```

Server registration:

```rust
#[derive(Deserialize, schemars::JsonSchema)]
struct RestRequestArgs {
    org: String,
    /// GET | POST | PATCH | PUT | DELETE
    method: String,
    /// Absolute API path starting with /services/ (e.g. /services/data/v62.0/limits).
    path: String,
    /// JSON body for POST/PATCH/PUT.
    body: Option<serde_json::Value>,
    /// Required true for writes against production orgs.
    confirm: Option<bool>,
}

#[tool(
    name = "rest_request",
    description = "Escape hatch: raw Salesforce REST call (path under /services/). Use when no dedicated tool covers the API. Writes to production refuse without confirm:true."
)]
async fn rest_request(&self, Parameters(a): Parameters<RestRequestArgs>) -> Result<Json<live::rest::RestDto>, ErrorData> {
    live::rest::rest(&self.live, &a.org, &a.method, &a.path, a.body.as_ref(), a.confirm.unwrap_or(false)).await.map(Json)
}
```

- [ ] **Step 4: Run tests + build**

Run: `cargo test -p uf-ost && cargo check -p uf-ost`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/uf-ost/src/live/rest.rs crates/uf-ost/src/live/mod.rs crates/uf-ost/src/server.rs
git commit -m "feat(uf-ost): rest_request escape hatch with write gating"
```

---

### Task 9: Telemetry wiring + server instructions + verification

**Files:**
- Modify: `crates/uf-ost/src/server.rs` (wrap every tool with telemetry; update `get_info` instructions)

**Interfaces:**
- Consumes: `Telemetry::log` (Task 2). All 18 tools (11 `ost_*` + 7 live) log through one helper.

- [ ] **Step 1: Add the logging helper to `OstServer`**

```rust
/// Wrap a tool future: measure duration, log outcome to telemetry, pass through.
async fn logged<T>(
    &self,
    tool: &str,
    org: Option<&str>,
    params: String,
    fut: impl std::future::Future<Output = Result<T, ErrorData>>,
) -> Result<T, ErrorData> {
    let start = std::time::Instant::now();
    let res = fut.await;
    self.live.telemetry.log(crate::telemetry::LogEntry {
        tool,
        org,
        params: &params,
        outcome: if res.is_ok() { "ok" } else { "error" },
        error: res.as_ref().err().map(|e| e.message.as_ref()),
        duration_ms: start.elapsed().as_millis() as u64,
    });
    res
}
```

Then mechanically wrap each tool body, e.g.:

```rust
async fn ost_object(&self, Parameters(a): Parameters<ObjectArgs>) -> Result<String, ErrorData> {
    let params = format!("object={} filter={:?}", a.object, a.filter);
    self.logged("ost_object", Some(&a.org.clone()), params, async {
        let snap = self.open(&a.org)?;
        query::object(&snap, &a.object, a.filter.as_deref()).map_err(to_err)
    })
    .await
}
```

For `soql_query`/`apex_run`, the params summary is the first 400 chars of the query/code (never the auth token — tokens never appear in tool args, keep it that way). If borrowing `a.org` into both the summary and the future fights the borrow checker, clone — this is not a hot path.

Note: `ErrorData.message` is a `Cow<str>` in rmcp 2.1.0 — `e.message.as_ref()` above; adjust if the field differs (check `rmcp::ErrorData`'s actual shape before writing all 18 call sites).

- [ ] **Step 2: Update server instructions in `get_info`** — replace the current text:

```text
Salesforce org toolkit. OFFLINE (ost_*): schema + Apex symbol index — consult before
writing SOQL/Apex; answers are stamped with org + snapshot age. LIVE: soql_query
(pre-validated), record_get/create/update/delete, apex_run, rest_request — use these
instead of `sf data query` / `sf apex run` / raw REST (structured output, no --json
pipelines). Mutations on production orgs require confirm:true AFTER user approval.
On schema contradiction: ost_sync, re-query; if unresolved, ost_reindex.
```

- [ ] **Step 3: Full workspace verification**

Run: `cargo test -p uf-ost -p features && cargo clippy -p uf-ost -p features -- -D warnings && ./scripts/check-arch.sh`
Expected: all PASS; check-arch confirms no file crossed 800 lines (if `server.rs` did after wrapping, split arg structs into `crates/uf-ost/src/server_args.rs` and re-run).

- [ ] **Step 4: Live smoke test** (needs an sf-authenticated org; use a **sandbox**, e.g. SFDC_Staging)

Build and run the server, drive it with a minimal stdio client — simplest is an inline test using the existing rmcp `transport-child-process` dev-dependency, or by hand:

```bash
cargo build -p uf-ost
# In an MCP-capable client (or `claude mcp add`): register target/debug/uf-ost serve
# Then verify, in order:
#  1. soql_query {org: SFDC_Staging, query: "SELECT Id, Name FROM Account LIMIT 3"} → rows
#  2. soql_query with a typo field → blocked offline with did-you-mean, NOT sent to org
#  3. record_get on one of the returned Ids → full record
#  4. apex_run {org: SFDC_Staging, code: "System.debug('hi');"} → success, debug contains 'hi'
#  5. sqlite3 <root>/telemetry.db 'SELECT tool, outcome FROM tool_log' → all calls logged
#  6. On a PROD org (SFDC_Live): record_update without confirm → refused with PRODUCTION message
```

Record the outcome of each check in the PR/commit message — fail loud if any check couldn't run (e.g. no prod org access): say which checks ran and which didn't.

- [ ] **Step 5: Commit**

```bash
git add crates/uf-ost/src/server.rs
git commit -m "feat(uf-ost): telemetry on every tool call + live-tool server instructions"
```

---

## Out of Scope (later phases — do not build now)

- **Plan 2 — deploy gate**: `deploy_precheck` (LastModifiedBy vs current user + org-vs-local diff) + `deploy` (gated shell-out to `sf project deploy start`) + day-one hook blocking raw `sf project deploy`. Planned separately after this lands.
- CLAUDE.md rule updates + hook hardening for query/DML/apex (migration phase C — after ~2 weeks of telemetry).
- npm wrapper version bump / release (existing OIDC release flow handles it when a release is cut).
- Bulk DML, `soql_diff`, telemetry anomaly detection, retrieve tools.

## Self-Review Notes

- Spec coverage: PRD tool table → Tasks 5 (soql_query), 6 (record_*), 7 (apex_run), 8 (rest_request); decision 4 → Task 1+5; decision 6 → Task 4; decision 7 → Tasks 2+9. Deploy (decision 5) and migration (decision 8) explicitly deferred with pointers.
- Type consistency: `Verdict{object_known, errors}` produced in Task 1, consumed in Task 5's `validation_block`; `Telemetry::{log, get_org_meta, set_org_meta}` produced in Task 2, consumed in Tasks 4/9; `rest_dml` fns produced in Task 3, consumed in Tasks 6/8; `gate_write`/`LiveCtx::{auth, is_prod, drop_auth}` produced in Task 4, consumed in 5/6/7/8.
- Known verify-at-implementation points (flagged inline): `outline()` return type (Task 1), `SfError` variants (Task 3), `FieldValue` shape (Task 4), `ErrorData.message` type (Task 9), schemars-on-`serde_json::Value` (Task 6 fallback given).
