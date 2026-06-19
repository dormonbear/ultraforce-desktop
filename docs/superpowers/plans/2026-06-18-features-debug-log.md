# features::debug_log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Build the `features` crate's `debug_log` module — list debug logs, fetch a log body, and parse it into a view model — wiring `sf-core` to `log-parser` end to end.

**Architecture:** `list_logs` / `get_log_body` call `sf` via `sf_core::SfInvoker::run_json`. `DebugLogView::from_log` is a pure pipeline (text → `ParsedLog` → per-unit `build_tree` + `extract_limits`). `fetch_and_parse` = `get_log_body` then `from_log`. A gated `#[ignore]` e2e test runs the real `sf` against staging.

**Tech Stack:** Rust 2021, serde (for the get-log result struct), sf-core + log-parser (path deps); dev: tokio, serde_json, sf-core `test-util` (MockRunner).

## Global Constraints

- Rust 2021. Crate at `crates/features` in the `sf-toolkit` workspace (`/Users/dormonzhou/Projects/sf-toolkit`).
- sf access only via `sf_core::SfInvoker`. No direct HTTP.
- English code/comments. Conventional commits, NO author-attribution/"Co-Authored-By" trailer.
- TDD per task; pristine test output. `cargo test -p features`; `cargo clippy -p features -- -D warnings` clean.
- Unit tests use `sf_core::runner::MockRunner` (never spawn real `sf`). The ONLY real-`sf` test is the `#[ignore]`-d e2e in `tests/e2e.rs`.
- Verified `sf` shapes: `sf apex list log --json` → `result` = array of ApexLog records (→ `sf_core::ApexLogRef`); `sf apex get log -i <id> --json` → `result` = `[{ "log": "<raw text>" }]`.
- You are on git branch `features-debug-log`. Never create/switch branches, never `git push`.

---

### Task 1: features crate scaffold

**Files:**
- Create: `crates/features/Cargo.toml`
- Create: `crates/features/src/lib.rs`
- Create: `crates/features/src/debug_log.rs` (empty placeholder)

**Interfaces:**
- Produces: buildable `features` crate depending on `sf-core` + `log-parser`, with `debug_log` module declared.

- [ ] **Step 1: Create the manifest**

`crates/features/Cargo.toml`:

```toml
[package]
name = "features"
version = "0.1.0"
edition.workspace = true
license.workspace = true

[dependencies]
sf-core = { path = "../sf-core" }
log-parser = { path = "../log-parser" }
serde = { workspace = true }

[dev-dependencies]
sf-core = { path = "../sf-core", features = ["test-util"] }
tokio = { workspace = true }
serde_json = { workspace = true }
```

- [ ] **Step 2: Create lib.rs and placeholder module**

`crates/features/src/lib.rs`:

```rust
//! features: feature-level orchestration wiring sf-core to the parsers.

pub mod debug_log;
```

Create the placeholder so it compiles:

```bash
cd /Users/dormonzhou/Projects/sf-toolkit
mkdir -p crates/features/src
printf '' > crates/features/src/debug_log.rs
```

- [ ] **Step 3: Verify it builds**

Run: `cd /Users/dormonzhou/Projects/sf-toolkit && cargo build -p features && cargo test -p features`
Expected: builds; 0 tests.

- [ ] **Step 4: Commit**

```bash
git add crates/features
git commit -m "chore(features): scaffold features crate with debug_log module"
```

---

### Task 2: list_logs

**Files:**
- Modify: `crates/features/src/debug_log.rs`

**Interfaces:**
- Consumes: `sf_core::{SfInvoker, ApexLogRef, SfError}`.
- Produces: `pub async fn list_logs(invoker: &SfInvoker) -> Result<Vec<ApexLogRef>, SfError>`.

- [ ] **Step 1: Write the failing test**

Append to `crates/features/src/debug_log.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use sf_core::SfInvoker;
    use std::sync::Arc;

    #[tokio::test]
    async fn list_logs_parses_records() {
        let json = r#"{"status":0,"result":[
            {"Id":"07L1","Operation":"/services/data","Status":"Success","StartTime":"2026-06-18T00:00:00.000+0000","LogLength":10,"DurationMilliseconds":5,"Application":"Unknown"},
            {"Id":"07L2","Operation":"Api","Status":"Success","StartTime":"2026-06-18T00:00:01.000+0000","LogLength":20,"DurationMilliseconds":7,"Application":"Unknown"}
        ]}"#;
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let logs = list_logs(&invoker).await.unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].id, "07L1");
        assert_eq!(logs[1].operation, "Api");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p features debug_log::tests::list_logs`
Expected: FAIL — `list_logs` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `crates/features/src/debug_log.rs` (above the test module):

```rust
use sf_core::{ApexLogRef, SfError, SfInvoker};

/// List recent debug logs via `sf apex list log`.
pub async fn list_logs(invoker: &SfInvoker) -> Result<Vec<ApexLogRef>, SfError> {
    invoker.run_json(&["apex", "list", "log"]).await
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p features debug_log::tests::list_logs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/debug_log.rs
git commit -m "feat(features): list debug logs via sf apex list log"
```

---

### Task 3: get_log_body

**Files:**
- Modify: `crates/features/src/debug_log.rs`

**Interfaces:**
- Consumes: `SfInvoker`, `SfError`, serde.
- Produces: `pub async fn get_log_body(invoker: &SfInvoker, id: &str) -> Result<String, SfError>` (private `LogBody { log: String }`).

- [ ] **Step 1: Write the failing test**

Add these two tests inside the existing `mod tests` block in `crates/features/src/debug_log.rs` (after the `list_logs_parses_records` test):

```rust
    #[tokio::test]
    async fn get_log_body_extracts_log_field() {
        let json = r#"{"status":0,"result":[{"log":"67.0 APEX_CODE,DEBUG\n16:00:00.0 (1)|EXECUTION_STARTED"}]}"#;
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let body = get_log_body(&invoker, "07L1").await.unwrap();
        assert!(body.contains("EXECUTION_STARTED"));
    }

    #[tokio::test]
    async fn get_log_body_errors_on_empty_result() {
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(r#"{"status":0,"result":[]}"#)));
        let err = get_log_body(&invoker, "x").await.unwrap_err();
        assert!(matches!(err, sf_core::SfError::Unexpected(_)), "got: {err:?}");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p features debug_log::tests::get_log_body`
Expected: FAIL — `get_log_body` not found.

- [ ] **Step 3: Write minimal implementation**

Add to `crates/features/src/debug_log.rs`, just below the `use` line and `list_logs` (above the test module). Add `use serde::Deserialize;` to the imports at the top of the file:

```rust
use serde::Deserialize;

#[derive(Deserialize)]
struct LogBody {
    log: String,
}

/// Fetch one debug log's raw body by Id via `sf apex get log -i <id>`.
pub async fn get_log_body(invoker: &SfInvoker, id: &str) -> Result<String, SfError> {
    let bodies: Vec<LogBody> = invoker.run_json(&["apex", "get", "log", "-i", id]).await?;
    bodies
        .into_iter()
        .next()
        .map(|b| b.log)
        .ok_or_else(|| SfError::Unexpected("empty `apex get log` result".to_string()))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p features debug_log::tests::get_log_body`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/debug_log.rs
git commit -m "feat(features): fetch a debug log body via sf apex get log"
```

---

### Task 4: DebugLogView + fetch_and_parse

**Files:**
- Modify: `crates/features/src/debug_log.rs`

**Interfaces:**
- Consumes: `log_parser::{header::LogHeader, parse::ParsedLog, tree::{build_tree, ExecNode}, limits::{extract_limits, LimitRollup}}`.
- Produces: `pub struct DebugLogView { header: Option<LogHeader>, units: Vec<UnitView> }`, `pub struct UnitView { tree: Vec<ExecNode>, limits: Vec<LimitRollup> }`, `DebugLogView::from_log(&str) -> DebugLogView`, `pub async fn fetch_and_parse(invoker, id) -> Result<DebugLogView, SfError>`.

- [ ] **Step 1: Write the failing test**

Add to the existing `mod tests` block in `crates/features/src/debug_log.rs`:

```rust
    const SAMPLE: &str = "67.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO\n\
16:00:00.0 (10)|EXECUTION_STARTED\n\
16:00:00.0 (20)|CODE_UNIT_STARTED|x\n\
16:00:00.0 (30)|LIMIT_USAGE_FOR_NS|(default)|\n\
\x20\x20Number of SOQL queries: 2 out of 100\n\
16:00:00.0 (40)|CODE_UNIT_FINISHED|x\n\
16:00:00.0 (50)|EXECUTION_FINISHED\n";

    #[test]
    fn from_log_builds_view() {
        let v = DebugLogView::from_log(SAMPLE);
        assert_eq!(v.header.as_ref().unwrap().api_version, "67.0");
        assert_eq!(v.units.len(), 1);
        assert_eq!(v.units[0].tree.len(), 1); // single EXECUTION root
        assert_eq!(v.units[0].limits[0].entries[0].used, 2);
    }

    #[tokio::test]
    async fn fetch_and_parse_wires_get_and_parse() {
        let log_json = serde_json::to_string(SAMPLE).unwrap();
        let json = format!(r#"{{"status":0,"result":[{{"log":{log_json}}}]}}"#);
        let invoker = SfInvoker::new(Arc::new(MockRunner::ok_json(json)));
        let v = fetch_and_parse(&invoker, "07L1").await.unwrap();
        assert_eq!(v.units.len(), 1);
        assert_eq!(v.header.unwrap().api_version, "67.0");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p features debug_log::tests::from_log_builds_view`
Expected: FAIL — `DebugLogView` not found.

- [ ] **Step 3: Write minimal implementation**

Add to the top-of-file imports of `crates/features/src/debug_log.rs`:

```rust
use log_parser::header::LogHeader;
use log_parser::limits::{extract_limits, LimitRollup};
use log_parser::parse::ParsedLog;
use log_parser::tree::{build_tree, ExecNode};
```

Add (above the test module):

```rust
/// One execution unit's derived views.
#[derive(Debug, Clone)]
pub struct UnitView {
    pub tree: Vec<ExecNode>,
    pub limits: Vec<LimitRollup>,
}

/// A parsed debug log ready for display: header plus per-unit tree + limits.
#[derive(Debug, Clone)]
pub struct DebugLogView {
    pub header: Option<LogHeader>,
    pub units: Vec<UnitView>,
}

impl DebugLogView {
    /// Pure pipeline: raw log text → view model.
    pub fn from_log(text: &str) -> DebugLogView {
        let parsed = ParsedLog::parse(text);
        let units = parsed
            .units
            .iter()
            .map(|u| UnitView {
                tree: build_tree(u),
                limits: extract_limits(u),
            })
            .collect();
        DebugLogView {
            header: parsed.header,
            units,
        }
    }
}

/// Fetch a log body by Id and parse it into a `DebugLogView`.
pub async fn fetch_and_parse(invoker: &SfInvoker, id: &str) -> Result<DebugLogView, SfError> {
    let body = get_log_body(invoker, id).await?;
    Ok(DebugLogView::from_log(&body))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p features debug_log::`
Expected: PASS (all unit tests: list 1, get_log 2, view 2).

- [ ] **Step 5: Commit**

```bash
git add crates/features/src/debug_log.rs
git commit -m "feat(features): parse a fetched log into a DebugLogView"
```

---

### Task 5: gated e2e test against staging

**Files:**
- Create: `crates/features/tests/e2e.rs`

**Interfaces:**
- Consumes: the crate's public `debug_log` API + `sf_core::{SfInvoker, ProcessRunner}`.
- Produces: a `#[ignore]`-d integration test exercising the real `sf` end to end.

- [ ] **Step 1: Write the e2e test**

`crates/features/tests/e2e.rs`:

```rust
//! End-to-end test against the live default org (staging sandbox).
//! Ignored by default; run with: `cargo test -p features -- --ignored`.

use features::debug_log::{fetch_and_parse, list_logs};
use sf_core::{ProcessRunner, SfInvoker};
use std::sync::Arc;

#[tokio::test]
#[ignore = "hits the live org; run explicitly with --ignored"]
async fn e2e_list_get_parse() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));

    let logs = list_logs(&invoker).await.expect("sf apex list log");
    assert!(!logs.is_empty(), "the org should have at least one debug log");

    let view = fetch_and_parse(&invoker, &logs[0].id)
        .await
        .expect("fetch + parse the first log");
    assert!(view.header.is_some(), "parsed log should have a header");
    assert!(!view.units.is_empty(), "parsed log should have >= 1 execution unit");
}
```

- [ ] **Step 2: Verify it compiles and is skipped by default**

Run: `cargo test -p features`
Expected: all unit tests pass; the e2e test shows as `ignored` (not run).

- [ ] **Step 3: Full verification and commit**

Run: `cargo test -p features && cargo clippy -p features -- -D warnings`
Expected: unit tests PASS, e2e ignored, clippy clean.

```bash
git add crates/features/tests/e2e.rs
git commit -m "test(features): add gated e2e for list/get/parse against staging"
```

Note: the controller runs `cargo test -p features -- --ignored` after merge as the post-stage e2e verification (per the standing project rule).

---

## Self-Review

- **Spec coverage:** `list_logs` (T2), `get_log_body` + `LogBody` (T3), `DebugLogView`/`UnitView`/`from_log`/`fetch_and_parse` (T4), gated e2e (T5), scaffold (T1). Trace-flag CRUD correctly deferred (not in this slice).
- **Placeholder scan:** every step has complete code + exact commands; no TBD.
- **Type consistency:** `SfInvoker`/`SfError`/`ApexLogRef` from sf-core; `ParsedLog`/`build_tree`/`ExecNode`/`extract_limits`/`LimitRollup`/`LogHeader` from log-parser — names match those crates' shipped public API. `get_log_body` (T3) is reused by `fetch_and_parse` (T4); `DebugLogView::from_log` (T4) used by the e2e (T5). `MockRunner::ok_json` + `SfInvoker::new(Arc::new(..))` usage matches sf-core.
```
