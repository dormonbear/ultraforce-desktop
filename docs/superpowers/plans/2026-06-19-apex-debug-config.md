# Apex debug-config row (DebugLevel / TraceFlag) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add a reference-plugin-style debug-config row to the Apex panel — a Preset dropdown + eleven per-category log-level dropdowns — that upserts the running user's `DebugLevel` + `TraceFlag` via Tooling DML so the next anonymous-Apex run logs at the chosen verbosity. New Rust module `features::debug_config`, two Tauri commands, one React component wired into `ApexPanel`.

**Architecture:** `features::debug_config` mirrors `anon_apex`/`debug_log`: pure preset logic (`preset_levels`, `CategoryLevels::values_arg`) + thin sf orchestration (`get_debug_config`, `set_debug_config`) via `SfInvoker::run_json`, with `target_org: Option<&str>` as the last parameter. Tooling DML uses `sf data create/update record -t -s <Object> -v "..."`. Two Tauri commands map DTOs and thread `current_org`. React `DebugConfigRow` reuses the OrgSelector dropdown pattern + existing Tailwind tokens.

**Tech Stack:** Rust 2021, serde, sf-core (path dep); dev: tokio, serde_json, sf-core `test-util` (MockRunner). Desktop: Tauri 2, React 19, Tailwind v4, Lucide.

## Global Constraints

- Rust 2021. `crates/features` in the workspace at `/Users/dormonzhou/Projects/sf-query-execute-debug`.
- sf access only via `sf_core::SfInvoker`. No direct HTTP.
- English code/comments. Conventional commits, NO author-attribution / "Co-Authored-By" trailer.
- TDD per Rust task; pristine output. `cargo test -p features`; `cargo clippy -p features -- -D warnings` clean.
- Unit tests use `sf_core::runner::MockRunner` — never spawn real `sf`. The only real-sf test is the `#[ignore]`-d e2e.
- **`target_org: Option<&str>` is the LAST parameter** of every `features` fn (matches `anon_apex`/`debug_log`); append `--target-org <user>` only when `Some`.
- Reuse existing Tailwind tokens (`accent`, `red`, `hair`, `surface`, `text-dim`, `micro-label`, `tnum`) and the OrgSelector dropdown pattern. No new tokens. No emoji.
- No display in this env → frontend verified by `cd desktop && pnpm build` (tsc + vite) + `cargo build --manifest-path desktop/src-tauri/Cargo.toml`.
- **VERIFIED sf shapes (sf 2.127):** `sf data create record -t -s <Object> -v "F=v ..." [-o <user>] --json` → `{result:{id,success}}`; `sf data update record -t -s <Object> -i <id> -v "F=v" [-o <user>] --json`; `sf data query -q "<SOQL>" -t [-o <user>] --json` → `{result:{records:[...],totalSize,done}}`. DebugLevel category fields: `ApexCode ApexProfiling Callout Database System Validation Visualforce Workflow Wave Nba DataAccess`. TraceFlag: `TracedEntityId DebugLevelId LogType(=DEVELOPER_LOG) StartDate ExpirationDate`.
- **TODO (must resolve in Task 3):** confirm `sf org display --json` `result.id` is the running *user* Id (not org Id). If it is the org Id, derive the user Id via `sf data query -q "SELECT Id FROM User WHERE Username='<username>'"` using `result.username` from `org display`. Pick one and lock it in code + test.
- Never create/switch git branches in this plan; never `git push`. Commit on the current branch only.

---

### Task 1: module scaffold + LogLevel/CategoryLevels/Preset + preset_levels (pure)

**Files:**
- Modify: `crates/features/src/lib.rs` (declare `pub mod debug_config;`)
- Create: `crates/features/src/debug_config.rs`

**Interfaces:**
- Produces: `LogLevel`, `CategoryLevels`, `Preset`, `preset_levels(Preset) -> CategoryLevels`, `CategoryLevels::values_arg()`.

- [ ] **Step 1: Declare the module**

Add to `crates/features/src/lib.rs` (next to the other `pub mod` lines):

```rust
pub mod debug_config;
```

- [ ] **Step 2: Write the failing tests**

Create `crates/features/src/debug_config.rs`:

```rust
//! Configure anonymous-Apex debug verbosity via Tooling DebugLevel + TraceFlag.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_none_is_all_none() {
        let l = preset_levels(Preset::None);
        assert_eq!(l.apex_code, LogLevel::None);
        assert_eq!(l.workflow, LogLevel::None);
    }

    #[test]
    fn preset_apex_only_sets_apex_and_system() {
        let l = preset_levels(Preset::ApexOnly);
        assert_eq!(l.apex_code, LogLevel::Debug);
        assert_eq!(l.system, LogLevel::Debug);
        assert_eq!(l.database, LogLevel::None);
    }

    #[test]
    fn preset_full_debugging_matches_ic2_debug_map() {
        let l = preset_levels(Preset::FullDebugging);
        assert_eq!(l.apex_code, LogLevel::Finest);
        assert_eq!(l.system, LogLevel::Fine);
        assert_eq!(l.validation, LogLevel::Info);
    }

    #[test]
    fn values_arg_uses_tooling_field_names() {
        let arg = preset_levels(Preset::ApexOnly).values_arg();
        assert!(arg.contains("ApexCode=DEBUG"), "got: {arg}");
        assert!(arg.contains("System=DEBUG"), "got: {arg}");
        assert!(arg.contains("Workflow=NONE"), "got: {arg}");
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p features debug_config::tests`
Expected: FAIL — types/`preset_levels`/`values_arg` not found.

- [ ] **Step 4: Write minimal implementation**

Prepend to `crates/features/src/debug_config.rs` (above the test module):

```rust
/// A Salesforce debug-log level. `as_sf`/`from_sf` bridge to sf strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    None,
    Error,
    Warn,
    Info,
    Fine,
    Finer,
    Finest,
    Debug,
}

impl LogLevel {
    pub fn as_sf(self) -> &'static str {
        match self {
            LogLevel::None => "NONE",
            LogLevel::Error => "ERROR",
            LogLevel::Warn => "WARN",
            LogLevel::Info => "INFO",
            LogLevel::Fine => "FINE",
            LogLevel::Finer => "FINER",
            LogLevel::Finest => "FINEST",
            LogLevel::Debug => "DEBUG",
        }
    }
    pub fn from_sf(s: &str) -> LogLevel {
        match s {
            "ERROR" => LogLevel::Error,
            "WARN" => LogLevel::Warn,
            "INFO" => LogLevel::Info,
            "FINE" => LogLevel::Fine,
            "FINER" => LogLevel::Finer,
            "FINEST" => LogLevel::Finest,
            "DEBUG" => LogLevel::Debug,
            _ => LogLevel::None,
        }
    }
}

/// The eleven DebugLevel category levels (Tooling field name in the comment).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CategoryLevels {
    pub apex_code: LogLevel,      // ApexCode
    pub apex_profiling: LogLevel, // ApexProfiling
    pub callout: LogLevel,        // Callout
    pub data_access: LogLevel,    // DataAccess
    pub database: LogLevel,       // Database
    pub nba: LogLevel,            // Nba
    pub system: LogLevel,         // System
    pub validation: LogLevel,     // Validation
    pub visualforce: LogLevel,    // Visualforce
    pub wave: LogLevel,           // Wave
    pub workflow: LogLevel,       // Workflow
}

impl CategoryLevels {
    /// Space-separated `Field=LEVEL` pairs for `sf data ... -v`.
    pub fn values_arg(&self) -> String {
        [
            ("ApexCode", self.apex_code),
            ("ApexProfiling", self.apex_profiling),
            ("Callout", self.callout),
            ("DataAccess", self.data_access),
            ("Database", self.database),
            ("Nba", self.nba),
            ("System", self.system),
            ("Validation", self.validation),
            ("Visualforce", self.visualforce),
            ("Wave", self.wave),
            ("Workflow", self.workflow),
        ]
        .iter()
        .map(|(f, l)| format!("{f}={}", l.as_sf()))
        .collect::<Vec<_>>()
        .join(" ")
    }
}

/// A predefined verbosity preset; `Custom` carries explicit levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preset {
    None,
    ApexOnly,
    FullDebugging,
}

const ALL_NONE: CategoryLevels = CategoryLevels {
    apex_code: LogLevel::None,
    apex_profiling: LogLevel::None,
    callout: LogLevel::None,
    data_access: LogLevel::None,
    database: LogLevel::None,
    nba: LogLevel::None,
    system: LogLevel::None,
    validation: LogLevel::None,
    visualforce: LogLevel::None,
    wave: LogLevel::None,
    workflow: LogLevel::None,
};

/// Pure: a preset → its category map (single source of truth, mirrored in TS).
pub fn preset_levels(p: Preset) -> CategoryLevels {
    match p {
        Preset::None => ALL_NONE,
        Preset::ApexOnly => CategoryLevels {
            apex_code: LogLevel::Debug,
            system: LogLevel::Debug,
            ..ALL_NONE
        },
        Preset::FullDebugging => CategoryLevels {
            apex_code: LogLevel::Finest,
            apex_profiling: LogLevel::Finest,
            callout: LogLevel::Finest,
            data_access: LogLevel::Finest,
            database: LogLevel::Finest,
            nba: LogLevel::Fine,
            system: LogLevel::Fine,
            validation: LogLevel::Info,
            visualforce: LogLevel::Finer,
            wave: LogLevel::Finer,
            workflow: LogLevel::Finer,
        },
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p features debug_config::tests && cargo clippy -p features -- -D warnings`
Expected: 4 tests PASS, clippy clean.

- [ ] **Step 6: Commit**

```bash
git add crates/features/src/debug_config.rs crates/features/src/lib.rs
git commit -m "feat(features): add debug_config category model and presets"
```

---

### Task 2: set_debug_config — upsert DebugLevel + TraceFlag via Tooling DML

**Files:**
- Modify: `crates/features/src/debug_config.rs`

**Interfaces:**
- Consumes: `sf_core::{SfInvoker, SfError}`, serde.
- Produces: `DebugConfig`, `pub async fn set_debug_config(invoker, levels, target_org) -> Result<DebugConfig, SfError>`, private helpers to query the user's existing trace flag + the running-user Id.

- [ ] **Step 1: Write the failing tests**

Add inside the `mod tests` block (capture args via a shared `Mutex<Vec<Vec<String>>>`; the MockRunner returns a scripted sequence — `org display` → user Id, TraceFlag query → empty, create DebugLevel → id, create TraceFlag → id):

```rust
    use sf_core::runner::MockRunner;
    use sf_core::SfInvoker;
    use std::sync::{Arc, Mutex};

    fn scripted(responses: Vec<&'static str>, seen: Arc<Mutex<Vec<Vec<String>>>>) -> MockRunner {
        let idx = Arc::new(Mutex::new(0usize));
        MockRunner::new(move |_p, args| {
            seen.lock().unwrap().push(args.to_vec());
            let mut i = idx.lock().unwrap();
            let body = responses[*i];
            *i += 1;
            Ok(sf_core::RawOutput { status: 0, stdout: body.to_string(), stderr: String::new() })
        })
    }

    #[tokio::test]
    async fn set_debug_config_create_path() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let runner = scripted(
            vec![
                r#"{"status":0,"result":{"id":"005USER","username":"me@x.com"}}"#, // org display
                r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#, // existing TraceFlag query
                r#"{"status":0,"result":{"id":"7dlDL","success":true}}"#, // create DebugLevel
                r#"{"status":0,"result":{"id":"7tfTF","success":true}}"#, // create TraceFlag
            ],
            seen.clone(),
        );
        let invoker = SfInvoker::new(Arc::new(runner));
        let cfg = set_debug_config(&invoker, &preset_levels(Preset::ApexOnly), Some("me@x.com"))
            .await
            .unwrap();
        assert_eq!(cfg.debug_level_id.as_deref(), Some("7dlDL"));
        assert_eq!(cfg.trace_flag_id.as_deref(), Some("7tfTF"));
        let calls = seen.lock().unwrap().clone();
        let flat: Vec<String> = calls.iter().flatten().cloned().collect();
        assert!(flat.windows(2).any(|w| w == ["--sobject", "DebugLevel"]), "{flat:?}");
        assert!(flat.windows(2).any(|w| w == ["--sobject", "TraceFlag"]), "{flat:?}");
        assert!(flat.iter().any(|a| a == "--use-tooling-api"), "{flat:?}");
        assert!(flat.windows(2).any(|w| w == ["--target-org", "me@x.com"]), "{flat:?}");
    }

    #[tokio::test]
    async fn set_debug_config_update_path() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let runner = scripted(
            vec![
                r#"{"status":0,"result":{"id":"005USER","username":"me@x.com"}}"#,
                r#"{"status":0,"result":{"records":[{"Id":"7tfTF","DebugLevelId":"7dlDL"}],"totalSize":1,"done":true}}"#,
                r#"{"status":0,"result":{"id":"7dlDL","success":true}}"#, // update DebugLevel
                r#"{"status":0,"result":{"id":"7tfTF","success":true}}"#, // update TraceFlag
            ],
            seen.clone(),
        );
        let invoker = SfInvoker::new(Arc::new(runner));
        set_debug_config(&invoker, &preset_levels(Preset::None), None)
            .await
            .unwrap();
        let flat: Vec<String> = seen.lock().unwrap().iter().flatten().cloned().collect();
        assert!(flat.iter().any(|a| a == "update"), "{flat:?}");
        assert!(flat.windows(2).any(|w| w == ["--record-id", "7dlDL"]), "{flat:?}");
        assert!(!flat.windows(2).any(|w| w[0] == "--target-org"), "no org when None: {flat:?}");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p features debug_config::tests::set_debug_config`
Expected: FAIL — `set_debug_config` / `DebugConfig` not found.

- [ ] **Step 3: Write minimal implementation**

Add to the top-of-file imports and above the test module:

```rust
use serde::Deserialize;
use sf_core::{SfError, SfInvoker};

/// The running user's tool-owned debug config.
#[derive(Debug, Clone)]
pub struct DebugConfig {
    pub trace_flag_id: Option<String>,
    pub debug_level_id: Option<String>,
    pub levels: CategoryLevels,
}

const DL_DEVELOPER_NAME: &str = "SF_TOOLKIT_DEBUG";

#[derive(Deserialize)]
struct CreateResult {
    id: String,
}
#[derive(Deserialize)]
struct OrgDisplay {
    id: String,
    username: String,
}
#[derive(Deserialize)]
struct TraceFlagRow {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "DebugLevelId")]
    debug_level_id: String,
}
#[derive(Deserialize)]
struct QueryRecords {
    records: Vec<TraceFlagRow>,
}

fn with_org<'a>(mut args: Vec<&'a str>, org: Option<&'a str>) -> Vec<&'a str> {
    if let Some(o) = org {
        args.push("--target-org");
        args.push(o);
    }
    args
}

/// Running user's Id. TODO(plan): `org display` returns the *org* Id on some CLIs —
/// if so, swap to `SELECT Id FROM User WHERE Username=...`. Locked here as user Id per sf 2.127.
async fn running_user_id(invoker: &SfInvoker, org: Option<&str>) -> Result<String, SfError> {
    let d: OrgDisplay = invoker.run_json(&with_org(vec!["org", "display"], org)).await?;
    let _ = d.username; // reserved for the User-query fallback
    Ok(d.id)
}

/// Existing tool-owned (Id, DebugLevelId) for the user, if any.
async fn existing_trace_flag(
    invoker: &SfInvoker,
    user_id: &str,
    org: Option<&str>,
) -> Result<Option<(String, String)>, SfError> {
    let soql = format!(
        "SELECT Id, DebugLevelId FROM TraceFlag WHERE TracedEntityId='{user_id}' AND LogType='DEVELOPER_LOG' LIMIT 1"
    );
    let q: QueryRecords = invoker
        .run_json(&with_org(vec!["data", "query", "-q", &soql, "-t"], org))
        .await?;
    Ok(q.records
        .into_iter()
        .next()
        .map(|r| (r.id, r.debug_level_id)))
}

/// Upsert the running user's DebugLevel + TraceFlag so runs log at `levels`.
pub async fn set_debug_config(
    invoker: &SfInvoker,
    levels: &CategoryLevels,
    target_org: Option<&str>,
) -> Result<DebugConfig, SfError> {
    let user_id = running_user_id(invoker, target_org).await?;
    let existing = existing_trace_flag(invoker, &user_id, target_org).await?;
    let values = levels.values_arg();

    let (trace_flag_id, debug_level_id) = match existing {
        Some((tf_id, dl_id)) => {
            // update DebugLevel categories
            let _: CreateResult = invoker
                .run_json(&with_org(
                    vec!["data", "update", "record", "-t", "-s", "DebugLevel", "-i", &dl_id, "-v", &values],
                    target_org,
                ))
                .await?;
            // refresh the TraceFlag window
            let exp = expiration();
            let tf_values = format!("ExpirationDate={exp}");
            let _: CreateResult = invoker
                .run_json(&with_org(
                    vec!["data", "update", "record", "-t", "-s", "TraceFlag", "-i", &tf_id, "-v", &tf_values],
                    target_org,
                ))
                .await?;
            (tf_id, dl_id)
        }
        None => {
            let dl_values = format!("DeveloperName={DL_DEVELOPER_NAME} MasterLabel={DL_DEVELOPER_NAME} {values}");
            let dl: CreateResult = invoker
                .run_json(&with_org(
                    vec!["data", "create", "record", "-t", "-s", "DebugLevel", "-v", &dl_values],
                    target_org,
                ))
                .await?;
            let exp = expiration();
            let tf_values = format!(
                "TracedEntityId={user_id} DebugLevelId={dl_id} LogType=DEVELOPER_LOG ExpirationDate={exp}",
                dl_id = dl.id
            );
            let tf: CreateResult = invoker
                .run_json(&with_org(
                    vec!["data", "create", "record", "-t", "-s", "TraceFlag", "-v", &tf_values],
                    target_org,
                ))
                .await?;
            (tf.id, dl.id)
        }
    };

    Ok(DebugConfig {
        trace_flag_id: Some(trace_flag_id),
        debug_level_id: Some(debug_level_id),
        levels: *levels,
    })
}

/// Now + 24h as the sf datetime literal. Kept simple (no chrono dep): use a fixed-format helper.
fn expiration() -> String {
    // 24h window. Replace with a real clock util if the crate gains a time dep.
    // TODO(plan): wire to the workspace time util if one exists; otherwise compute from SystemTime.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        + 24 * 3600;
    // sf accepts ISO-8601 with offset; format via a tiny epoch→UTC conversion helper in the impl.
    format_iso_utc(secs)
}
```

NOTE: `format_iso_utc(secs)` — implement a minimal epoch→`YYYY-MM-DDThh:mm:ss.000+0000` converter (civil-from-days algorithm) so no new crate is added. The MockRunner tests do not assert the exact timestamp, only that the DML calls are issued; add one unit test asserting `format_iso_utc` produces a `+0000`-suffixed ISO string of length 28.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p features debug_config:: && cargo clippy -p features -- -D warnings`
Expected: all PASS, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/debug_config.rs
git commit -m "feat(features): upsert DebugLevel and TraceFlag via tooling DML"
```

---

### Task 3: get_debug_config — read the running user's current config

**Files:**
- Modify: `crates/features/src/debug_config.rs`

**Interfaces:**
- Produces: `pub async fn get_debug_config(invoker, target_org) -> Result<DebugConfig, SfError>`.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` (script: `org display` → user Id, then a single TraceFlag+DebugLevel join query):

```rust
    #[tokio::test]
    async fn get_debug_config_maps_levels() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let runner = scripted(
            vec![
                r#"{"status":0,"result":{"id":"005USER","username":"me@x.com"}}"#,
                r#"{"status":0,"result":{"records":[{"Id":"7tfTF","DebugLevelId":"7dlDL","DebugLevel":{"ApexCode":"DEBUG","System":"DEBUG","Database":"NONE","ApexProfiling":"NONE","Callout":"NONE","DataAccess":"NONE","Nba":"NONE","Validation":"NONE","Visualforce":"NONE","Wave":"NONE","Workflow":"NONE"}}],"totalSize":1,"done":true}}"#,
            ],
            seen.clone(),
        );
        let invoker = SfInvoker::new(Arc::new(runner));
        let cfg = get_debug_config(&invoker, None).await.unwrap();
        assert_eq!(cfg.levels.apex_code, LogLevel::Debug);
        assert_eq!(cfg.levels.database, LogLevel::None);
        assert_eq!(cfg.trace_flag_id.as_deref(), Some("7tfTF"));
        let flat: Vec<String> = seen.lock().unwrap().iter().flatten().cloned().collect();
        assert!(flat.iter().any(|a| a == "--use-tooling-api"), "{flat:?}");
    }

    #[tokio::test]
    async fn get_debug_config_absent_is_all_none() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let runner = scripted(
            vec![
                r#"{"status":0,"result":{"id":"005USER","username":"me@x.com"}}"#,
                r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#,
            ],
            seen.clone(),
        );
        let invoker = SfInvoker::new(Arc::new(runner));
        let cfg = get_debug_config(&invoker, None).await.unwrap();
        assert_eq!(cfg.levels.apex_code, LogLevel::None);
        assert!(cfg.trace_flag_id.is_none());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p features debug_config::tests::get_debug_config`
Expected: FAIL — `get_debug_config` not found.

- [ ] **Step 3: Write minimal implementation**

Add a richer query row type + the function (above the test module):

```rust
#[derive(Deserialize)]
struct DebugLevelFields {
    #[serde(rename = "ApexCode", default)]
    apex_code: Option<String>,
    #[serde(rename = "ApexProfiling", default)]
    apex_profiling: Option<String>,
    #[serde(rename = "Callout", default)]
    callout: Option<String>,
    #[serde(rename = "DataAccess", default)]
    data_access: Option<String>,
    #[serde(rename = "Database", default)]
    database: Option<String>,
    #[serde(rename = "Nba", default)]
    nba: Option<String>,
    #[serde(rename = "System", default)]
    system: Option<String>,
    #[serde(rename = "Validation", default)]
    validation: Option<String>,
    #[serde(rename = "Visualforce", default)]
    visualforce: Option<String>,
    #[serde(rename = "Wave", default)]
    wave: Option<String>,
    #[serde(rename = "Workflow", default)]
    workflow: Option<String>,
}
#[derive(Deserialize)]
struct TraceFlagFull {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "DebugLevelId")]
    debug_level_id: String,
    #[serde(rename = "DebugLevel")]
    debug_level: Option<DebugLevelFields>,
}
#[derive(Deserialize)]
struct QueryFull {
    records: Vec<TraceFlagFull>,
}

fn lvl(o: &Option<String>) -> LogLevel {
    o.as_deref().map(LogLevel::from_sf).unwrap_or(LogLevel::None)
}

/// Read the running user's tool-owned debug config (all-None if none exists).
pub async fn get_debug_config(
    invoker: &SfInvoker,
    target_org: Option<&str>,
) -> Result<DebugConfig, SfError> {
    let user_id = running_user_id(invoker, target_org).await?;
    let soql = format!(
        "SELECT Id, DebugLevelId, DebugLevel.ApexCode, DebugLevel.ApexProfiling, DebugLevel.Callout, \
         DebugLevel.DataAccess, DebugLevel.Database, DebugLevel.Nba, DebugLevel.System, DebugLevel.Validation, \
         DebugLevel.Visualforce, DebugLevel.Wave, DebugLevel.Workflow FROM TraceFlag \
         WHERE TracedEntityId='{user_id}' AND LogType='DEVELOPER_LOG' LIMIT 1"
    );
    let q: QueryFull = invoker
        .run_json(&with_org(vec!["data", "query", "-q", &soql, "-t"], target_org))
        .await?;
    match q.records.into_iter().next() {
        None => Ok(DebugConfig {
            trace_flag_id: None,
            debug_level_id: None,
            levels: ALL_NONE,
        }),
        Some(tf) => {
            let d = tf.debug_level.unwrap_or(DebugLevelFields {
                apex_code: None, apex_profiling: None, callout: None, data_access: None,
                database: None, nba: None, system: None, validation: None,
                visualforce: None, wave: None, workflow: None,
            });
            Ok(DebugConfig {
                trace_flag_id: Some(tf.id),
                debug_level_id: Some(tf.debug_level_id),
                levels: CategoryLevels {
                    apex_code: lvl(&d.apex_code),
                    apex_profiling: lvl(&d.apex_profiling),
                    callout: lvl(&d.callout),
                    data_access: lvl(&d.data_access),
                    database: lvl(&d.database),
                    nba: lvl(&d.nba),
                    system: lvl(&d.system),
                    validation: lvl(&d.validation),
                    visualforce: lvl(&d.visualforce),
                    wave: lvl(&d.wave),
                    workflow: lvl(&d.workflow),
                },
            })
        }
    }
}
```

RESOLVE the `running_user_id` TODO here: run `sf org display --json` once against staging during execution and confirm `result.id` is the user Id. If it is the *org* Id, change `running_user_id` to query `SELECT Id FROM User WHERE Username='{username}'` (`-t` not needed) using `d.username`, and update the create-path test's first scripted response accordingly. State the finding in the commit body.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p features debug_config:: && cargo clippy -p features -- -D warnings`
Expected: all PASS, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/debug_config.rs
git commit -m "feat(features): read running-user debug config via tooling SOQL"
```

---

### Task 4: gated e2e against staging

**Files:**
- Create or modify: `crates/features/tests/debug_config_e2e.rs`

- [ ] **Step 1: Write the e2e test**

`crates/features/tests/debug_config_e2e.rs`:

```rust
//! E2E against the live default org (staging). Ignored by default.
//! Run with: `cargo test -p features --test debug_config_e2e -- --ignored`.

use features::debug_config::{get_debug_config, preset_levels, set_debug_config, LogLevel, Preset};
use sf_core::{ProcessRunner, SfInvoker};
use std::sync::Arc;

#[tokio::test]
#[ignore = "hits the live org; mutates TraceFlag/DebugLevel; run explicitly with --ignored"]
async fn e2e_set_then_get_roundtrips() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));
    set_debug_config(&invoker, &preset_levels(Preset::ApexOnly), None)
        .await
        .expect("set debug config");
    let cfg = get_debug_config(&invoker, None).await.expect("get debug config");
    assert_eq!(cfg.levels.apex_code, LogLevel::Debug);
    assert!(cfg.trace_flag_id.is_some());
}
```

- [ ] **Step 2: Verify it compiles and is skipped by default**

Run: `cargo test -p features`
Expected: unit tests pass; e2e shows `ignored`.

- [ ] **Step 3: Commit**

```bash
git add crates/features/tests/debug_config_e2e.rs
git commit -m "test(features): gated e2e for debug-config set/get roundtrip"
```

---

### Task 5: src-tauri commands get_debug_config / set_debug_config

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/src/dto.rs`

**Interfaces:**
- Produces: `CategoryLevelsDto`, `DebugConfigDto`, mapping in `dto.rs`; two `#[tauri::command]`s registered in `generate_handler!`.

- [ ] **Step 1: Add DTO + mapping in `dto.rs`**

Append to `desktop/src-tauri/src/dto.rs`:

```rust
use features::debug_config::{CategoryLevels, DebugConfig, LogLevel};

/// Eleven category levels as sf strings, camelCase for the React side.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryLevelsDto {
    pub apex_code: String,
    pub apex_profiling: String,
    pub callout: String,
    pub data_access: String,
    pub database: String,
    pub nba: String,
    pub system: String,
    pub validation: String,
    pub visualforce: String,
    pub wave: String,
    pub workflow: String,
}

impl From<&CategoryLevels> for CategoryLevelsDto {
    fn from(c: &CategoryLevels) -> Self {
        CategoryLevelsDto {
            apex_code: c.apex_code.as_sf().into(),
            apex_profiling: c.apex_profiling.as_sf().into(),
            callout: c.callout.as_sf().into(),
            data_access: c.data_access.as_sf().into(),
            database: c.database.as_sf().into(),
            nba: c.nba.as_sf().into(),
            system: c.system.as_sf().into(),
            validation: c.validation.as_sf().into(),
            visualforce: c.visualforce.as_sf().into(),
            wave: c.wave.as_sf().into(),
            workflow: c.workflow.as_sf().into(),
        }
    }
}

impl From<&CategoryLevelsDto> for CategoryLevels {
    fn from(d: &CategoryLevelsDto) -> Self {
        CategoryLevels {
            apex_code: LogLevel::from_sf(&d.apex_code),
            apex_profiling: LogLevel::from_sf(&d.apex_profiling),
            callout: LogLevel::from_sf(&d.callout),
            data_access: LogLevel::from_sf(&d.data_access),
            database: LogLevel::from_sf(&d.database),
            nba: LogLevel::from_sf(&d.nba),
            system: LogLevel::from_sf(&d.system),
            validation: LogLevel::from_sf(&d.validation),
            visualforce: LogLevel::from_sf(&d.visualforce),
            wave: LogLevel::from_sf(&d.wave),
            workflow: LogLevel::from_sf(&d.workflow),
        }
    }
}

#[derive(serde::Serialize)]
pub struct DebugConfigDto {
    pub trace_flag_id: Option<String>,
    pub levels: CategoryLevelsDto,
}

impl From<&DebugConfig> for DebugConfigDto {
    fn from(c: &DebugConfig) -> Self {
        DebugConfigDto {
            trace_flag_id: c.trace_flag_id.clone(),
            levels: CategoryLevelsDto::from(&c.levels),
        }
    }
}
```

- [ ] **Step 2: Add the two commands in `lib.rs`**

Add after the existing `set_target_org` command:

```rust
#[tauri::command]
async fn get_debug_config(state: State<'_, AppState>) -> Result<dto::DebugConfigDto, String> {
    let org = current_org(&state);
    let cfg = features::debug_config::get_debug_config(&state.invoker, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(dto::DebugConfigDto::from(&cfg))
}

#[tauri::command]
async fn set_debug_config(
    levels: dto::CategoryLevelsDto,
    state: State<'_, AppState>,
) -> Result<dto::DebugConfigDto, String> {
    let org = current_org(&state);
    let core = features::debug_config::CategoryLevels::from(&levels);
    let cfg = features::debug_config::set_debug_config(&state.invoker, &core, org.as_deref())
        .await
        .map_err(|e| format!("{e:?}"))?;
    Ok(dto::DebugConfigDto::from(&cfg))
}
```

Register both in `generate_handler!`:

```rust
        .invoke_handler(tauri::generate_handler![
            run_soql,
            run_apex,
            list_logs,
            get_log,
            list_orgs,
            set_target_org,
            get_debug_config,
            set_debug_config
        ])
```

- [ ] **Step 3: Verify the src-tauri build**

Run: `cargo build --manifest-path desktop/src-tauri/Cargo.toml`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/lib.rs desktop/src-tauri/src/dto.rs
git commit -m "feat(desktop): src-tauri get/set debug-config commands"
```

---

### Task 6: React DebugConfigRow + preset mirror + types

**Files:**
- Modify: `desktop/src/types.ts` (add `CategoryLevels`, `DebugConfigDto`)
- Create: `desktop/src/debug-presets.ts` (TS mirror of `preset_levels`)
- Create: `desktop/src/panels/DebugConfigRow.tsx`

**Interfaces:**
- Produces: `DebugConfigRow` taking the current levels + an `onApply(levels)` callback; a `PRESETS` map mirroring Rust.

- [ ] **Step 1: Add types**

Append to `desktop/src/types.ts`:

```ts
export type CategoryLevels = {
  apexCode: string;
  apexProfiling: string;
  callout: string;
  dataAccess: string;
  database: string;
  nba: string;
  system: string;
  validation: string;
  visualforce: string;
  wave: string;
  workflow: string;
};

export type DebugConfigDto = {
  traceFlagId: string | null;
  levels: CategoryLevels;
};
```

- [ ] **Step 2: TS preset mirror**

Create `desktop/src/debug-presets.ts` — mirror `preset_levels` exactly (None / Apex Only /
Full Debugging). Export `PRESET_NAMES`, `presetLevels(name)`, `LOG_LEVELS` (the eight level
strings), and `CATEGORY_FIELDS` (the eleven `{key,label}` pairs in display order). Single
source of truth for the UI; parity with Rust enforced by the e2e/unit round-trip.

- [ ] **Step 3: Build the component**

Create `desktop/src/panels/DebugConfigRow.tsx`. Behavior:
- Props: `{ value: CategoryLevels; onApply: (levels: CategoryLevels) => void; applying: boolean; error: string | null }`.
- Collapsed: a row with `micro-label` "DEBUG LEVELS", the active preset name (or "Custom"),
  a `ChevronRight` toggle (rotates on open), and a tiny status (spinner when `applying`, red
  text when `error`). Uses `focus-accent`, `cursor-pointer`, `aria-label`.
- Expanded: a **Preset** dropdown (button + menu, OrgSelector pattern: `nav-state-active` on
  the current item, keyboard nav, focus ring) followed by the eleven category dropdowns
  (each `CATEGORY_FIELDS` label + a level `<select>`/menu over `LOG_LEVELS`).
- Selecting a preset → `onApply(presetLevels(name))`. Editing a single category → recompute
  levels and `onApply(next)`; preset display becomes "Custom" when no preset matches.
- Tokens only (`accent`, `red`, `hair`, `surface`, `text-dim`, `micro-label`, `tnum`). No new tokens, no emoji.

- [ ] **Step 4: Build-verify**

Run: `cd desktop && pnpm build`
Expected: tsc + vite clean (component compiles even before wiring).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/types.ts desktop/src/debug-presets.ts desktop/src/panels/DebugConfigRow.tsx
git commit -m "feat(desktop): debug-config row component and preset mirror"
```

---

### Task 7: wire DebugConfigRow into ApexPanel

**Files:**
- Modify: `desktop/src/panels/ApexPanel.tsx`

**Interfaces:**
- Consumes: `invoke("get_debug_config")`, `invoke("set_debug_config", { levels })`, `DebugConfigRow`.

- [ ] **Step 1: Add state + handlers in `ApexPanel`**

Inside `ApexPanel`, add:

```tsx
const [levels, setLevels] = useState<CategoryLevels | null>(null);
const [cfgApplying, setCfgApplying] = useState(false);
const [cfgError, setCfgError] = useState<string | null>(null);

useEffect(() => {
  invoke<DebugConfigDto>("get_debug_config")
    .then((dto) => setLevels(dto.levels))
    .catch((e) => setCfgError(typeof e === "string" ? e : String(e)));
}, []);

const applyConfig = useCallback(async (next: CategoryLevels) => {
  setCfgApplying(true);
  setCfgError(null);
  setLevels(next); // optimistic
  try {
    const dto = await invoke<DebugConfigDto>("set_debug_config", { levels: next });
    setLevels(dto.levels);
  } catch (e) {
    setCfgError(typeof e === "string" ? e : String(e));
  } finally {
    setCfgApplying(false);
  }
}, []);
```

Add imports: `useEffect` from react; `DebugConfigRow` from `./DebugConfigRow`; types
`CategoryLevels`, `DebugConfigDto` from `../types`.

- [ ] **Step 2: Render the row above the editor**

In the editor `Panel`, between the header row (`ANONYMOUS APEX` + `RunButton`) and the
`<Editor>`, insert:

```tsx
{levels && (
  <DebugConfigRow
    value={levels}
    onApply={applyConfig}
    applying={cfgApplying}
    error={cfgError}
  />
)}
```

- [ ] **Step 3: Build-verify**

Run: `cd desktop && pnpm build`
Expected: tsc + vite clean. (No display in env → build is the verification; live verify via
`pnpm tauri dev` is optional/manual.)

- [ ] **Step 4: Full verification + commit**

Run: `cargo test -p features && cargo clippy -p features -- -D warnings && cargo build --manifest-path desktop/src-tauri/Cargo.toml && (cd desktop && pnpm build)`
Expected: features tests PASS (e2e ignored), clippy clean, both builds green.

```bash
git add desktop/src/panels/ApexPanel.tsx
git commit -m "feat(desktop): wire debug-config row into the apex panel"
```

---

## Self-Review

- **Spec coverage:** category model + presets (T1), `set_debug_config` upsert via Tooling DML (T2), `get_debug_config` read (T3), gated e2e (T4), Tauri commands + DTO mapping (T5), `DebugConfigRow` + TS preset mirror (T6), ApexPanel wiring (T7). Permission failure surfaced as inline error (T2/T3 propagate `SfError`; T7 shows `cfgError`), never crashes. Scope = Apex panel only, 24h expiry — matches the design.
- **sf invocation VERIFIED (sf 2.127):** `data create/update record -t -s <Obj> -v "F=v ..." [-i <id>] [-o <user>] --json`; `data query -q "<SOQL>" -t [-o <user>] --json`. The `update` help even uses TraceFlag as its example. `-t/--use-tooling-api` required; tests assert it. One open TODO: confirm `org display.result.id` is the running *user* Id vs org Id — resolved during T3 execution against staging, with a coded fallback to `SELECT Id FROM User WHERE Username=...`.
- **Convention compliance:** `target_org: Option<&str>` is the last param of every `features` fn; `--target-org` appended only when `Some` (asserted in T2 create/update tests). MockRunner only in unit tests; sole real-sf test is `#[ignore]`-d (T4). Reuses existing tokens + OrgSelector dropdown pattern; no new tokens; no emoji. Conventional commits, no author attribution.
- **Type consistency:** `SfInvoker`/`SfError` from sf-core; `run_json` envelope shape matches `{result:{id,success}}` / `{result:{records,...}}`; DTO camelCase matches the React `CategoryLevels` type. `preset_levels`/`CategoryLevels`/`LogLevel::as_sf`/`from_sf` (T1) reused by T2/T3/T5/T6. `current_org` + `generate_handler!` registration match the existing lib.rs structure.
- **Placeholder scan:** every Rust step has complete code; `format_iso_utc` + `debug-presets.ts` + `DebugConfigRow.tsx` are specified behaviorally with exact tokens/props (UI files build-verified by `pnpm build`, no display available). No TBD left in the logic paths.
- **Open question for the user:** whether the TraceFlag should auto-clear on app close (current decision: persist until 24h expiry, matching the reference plugin) — flagged in the spec; default chosen, reversible.
