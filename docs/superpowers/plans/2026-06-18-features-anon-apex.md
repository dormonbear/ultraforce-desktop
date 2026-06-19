# SP-C features::anon_apex (thin slice) Implementation Plan

> Date: 2026-06-18 · Crate: `crates/features` (module `anon_apex`) · Depends on: sf-core, log-parser
> Spec: specs/2026-06-18-features-anon-apex-design.md

Implements the anonymous-Apex execution slice: run a source string via
`sf apex run -f <file> --json` → typed `ApexRunResult` → an `AnonApexOutcome`
that exposes success / compile error (line/column/problem) / runtime exception
(message + stack trace) and the parsed debug log (reusing SP-A
`debug_log::DebugLogView::from_log` on the inline `logs` string). TDD
throughout. Mirrors SP-A/SP-B (MockRunner unit tests + a gated e2e).

## Global Constraints

- New code lives in `crates/features` (existing crate); add `pub mod anon_apex;`
  to its `lib.rs` (keep `soql` and `debug_log`). No new crate, no new external
  deps — temp file via `std::env::temp_dir` (NO `tempfile`).
- Reuse `sf_core::{SfInvoker, SfError}`, `sf_core::runner::{MockRunner, RawOutput}`,
  and `debug_log::DebugLogView` (already in this crate). `features` already
  dev-deps `sf-core` with `test-util` and `serde_json`; add `serde_json` to
  `[dev-dependencies]` is already present — confirm, no change needed.
- **Use `run_raw` + manual envelope handling, NOT `run_json`.** Compile failures
  exit non-zero with the payload in `data`; `run_json` maps non-zero status to
  `SfError::Command` and would discard the payload.
- Define a module-local `ApexRunResult` in `anon_apex` (Option-based, tolerant
  `line`/`column`). Do NOT reuse `sf_core::models::ApexRunResult` — its fields
  are non-`Option` `String`/`i64` and cannot represent the string-typed
  `line`/`column` that `sf` returns on compile failure, nor distinguish empty
  from absent. (Deviation noted: spec §Model defines the type in this module.)
- Verified `sf` shapes (sf 2.127, against staging):
  - **Success / runtime exception** → envelope `status: 0`, `result` =
    `{ compiled, success, compileProblem, exceptionMessage, exceptionStackTrace,
    line (number|null), column (number|null), logs }`.
  - **Compile failure** → envelope `status: 1`, `name: "executeCompileFailure"`,
    same shape in **`data`**; here `line`/`column` are **strings** (e.g. `"1"`,
    `"9"`), `logs` empty.
  - **Genuine CLI/transport error** → `status: 1`, `name: "Error"`, no
    `data.compiled` → surface as `SfError::Command`.
- `line`/`column` deserialize via a helper accepting JSON string, number, or
  null → `Option<i64>` (empty/blank string → `None`). Empty
  `compileProblem`/`exceptionMessage`/`exceptionStackTrace` strings → `None`.
- Every task RED→GREEN; `cargo test -p features` after each. At the end:
  `cargo clippy -p features --all-targets -- -D warnings` clean and
  `cargo fmt --all --check` stays clean. Existing soql + debug_log tests MUST
  NOT break. Do NOT run the `#[ignore]` e2e in the normal suite.
- You are on git branch `build/foundation`. Never create/switch branches, never
  `git push`. NO author-attribution / "Co-Authored-By" / "Claude-Session"
  trailer.

---

### Task 1: Scaffold the anon_apex module

**Files:**
- Modify: `crates/features/src/lib.rs`
- Create: `crates/features/src/anon_apex.rs` (empty placeholder)

**Interfaces:**
- Produces: buildable `features` crate with `anon_apex` module declared
  alongside `soql` and `debug_log`.

- [ ] **Step 1: Wire the module**

Edit `crates/features/src/lib.rs` to add `pub mod anon_apex;` (keep the existing
`debug_log` and `soql` declarations):

```rust
//! features: user-facing Salesforce toolkit features built on `sf-core`.

pub mod anon_apex;
pub mod debug_log;
pub mod soql;
```

- [ ] **Step 2: Create the placeholder module**

```bash
cd /Users/dormonzhou/Projects/sf-query-execute-debug
printf '' > crates/features/src/anon_apex.rs
```

- [ ] **Step 3: Verify it builds**

Run: `cargo build -p features && cargo test -p features`
Expected: builds; existing soql + debug_log tests pass; 0 new tests.

(No commit yet — the placeholder is committed together with Task 2+ as one
feature commit per the final verification step.)

---

### Task 2: model types — ApexRunResult, AnonApexOutcome, ApexError

**Files:**
- Modify: `crates/features/src/anon_apex.rs`

**Interfaces:**
- Consumes: `serde`, `crate::debug_log::DebugLogView`.
- Produces: `pub struct ApexRunResult { compiled, success, compile_problem:
  Option<String>, exception_message: Option<String>, exception_stack_trace:
  Option<String>, line: Option<i64>, column: Option<i64>, logs: String }`;
  `pub struct AnonApexOutcome { result: ApexRunResult, log_view:
  Option<DebugLogView> }`; `pub enum ApexError { Compile{message,line,column},
  Runtime{message,stack_trace} }`; `impl ApexRunResult { fn error(&self) ->
  Option<ApexError> }`. Private serde helpers for tolerant line/column and
  empty-string-to-None.

- [ ] **Step 1: Write the failing test**

Append to `crates/features/src/anon_apex.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_runtime_result_number_line() {
        let json = r#"{"compiled":true,"success":false,"compileProblem":"",
            "exceptionMessage":"System.NullPointerException: x",
            "exceptionStackTrace":"AnonymousBlock: line 2, column 1",
            "line":2,"column":1,"logs":"67.0 APEX_CODE,DEBUG\nx"}"#;
        let r: ApexRunResult = serde_json::from_str(json).unwrap();
        assert!(r.compiled && !r.success);
        assert_eq!(r.line, Some(2));
        assert_eq!(r.column, Some(1));
        assert!(r.compile_problem.is_none());
        assert_eq!(
            r.exception_message.as_deref(),
            Some("System.NullPointerException: x")
        );
        match r.error().unwrap() {
            ApexError::Runtime { message, stack_trace } => {
                assert!(message.contains("NullPointer"));
                assert!(stack_trace.unwrap().contains("line 2"));
            }
            other => panic!("expected Runtime, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_compile_result_string_line_and_error() {
        let json = r#"{"compiled":false,"success":false,
            "compileProblem":"Unexpected token 'x'.","exceptionMessage":"",
            "exceptionStackTrace":"","line":"1","column":"9","logs":""}"#;
        let r: ApexRunResult = serde_json::from_str(json).unwrap();
        assert!(!r.compiled);
        assert_eq!(r.line, Some(1));
        assert_eq!(r.column, Some(9));
        match r.error().unwrap() {
            ApexError::Compile { message, line, column } => {
                assert_eq!(message, "Unexpected token 'x'.");
                assert_eq!((line, column), (Some(1), Some(9)));
            }
            other => panic!("expected Compile, got {other:?}"),
        }
    }

    #[test]
    fn blank_line_and_empty_strings_become_none() {
        let json = r#"{"compiled":true,"success":true,"compileProblem":"",
            "exceptionMessage":"","exceptionStackTrace":"","line":"","column":null,
            "logs":""}"#;
        let r: ApexRunResult = serde_json::from_str(json).unwrap();
        assert!(r.success);
        assert_eq!(r.line, None);
        assert_eq!(r.column, None);
        assert!(r.compile_problem.is_none());
        assert!(r.exception_message.is_none());
        assert!(r.error().is_none()); // compiled && success → no error
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p features anon_apex::tests::deserializes_runtime_result_number_line`
Expected: FAIL — `ApexRunResult` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `crates/features/src/anon_apex.rs` (above the test module):

```rust
use serde::{Deserialize, Deserializer};

use crate::debug_log::DebugLogView;

/// Result of one `sf apex run`. Module-local (not `sf_core::ApexRunResult`)
/// because `sf` returns `line`/`column` as JSON strings on compile failure and
/// numbers/null otherwise, and empty problem/message strings must map to `None`.
#[derive(Debug, Clone, Deserialize)]
pub struct ApexRunResult {
    pub compiled: bool,
    pub success: bool,
    #[serde(rename = "compileProblem", default, deserialize_with = "empty_to_none")]
    pub compile_problem: Option<String>,
    #[serde(rename = "exceptionMessage", default, deserialize_with = "empty_to_none")]
    pub exception_message: Option<String>,
    #[serde(
        rename = "exceptionStackTrace",
        default,
        deserialize_with = "empty_to_none"
    )]
    pub exception_stack_trace: Option<String>,
    #[serde(default, deserialize_with = "lenient_opt_i64")]
    pub line: Option<i64>,
    #[serde(default, deserialize_with = "lenient_opt_i64")]
    pub column: Option<i64>,
    #[serde(default)]
    pub logs: String,
}

/// Map `""` to `None`, any non-empty string to `Some`.
fn empty_to_none<'de, D>(de: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = Option::<String>::deserialize(de)?;
    Ok(opt.filter(|s| !s.is_empty()))
}

/// Accept JSON string, number, or null → `Option<i64>`; blank string → `None`.
fn lenient_opt_i64<'de, D>(de: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;
    use serde_json::Value;
    match Value::deserialize(de)? {
        Value::Null => Ok(None),
        Value::Number(n) => Ok(n.as_i64()),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                Ok(None)
            } else {
                t.parse::<i64>().map(Some).map_err(D::Error::custom)
            }
        }
        other => Err(D::Error::custom(format!("expected i64-ish, got {other}"))),
    }
}

/// A finished anonymous-Apex run: the typed result plus the parsed debug log
/// (when `sf` returned any log text).
#[derive(Debug, Clone)]
pub struct AnonApexOutcome {
    pub result: ApexRunResult,
    pub log_view: Option<DebugLogView>,
}

/// Derived, display-ready error location for the UI.
#[derive(Debug, Clone)]
pub enum ApexError {
    Compile {
        message: String,
        line: Option<i64>,
        column: Option<i64>,
    },
    Runtime {
        message: String,
        stack_trace: Option<String>,
    },
}

impl ApexRunResult {
    /// `Compile` when it did not compile, else `Runtime` when it compiled but
    /// failed, else `None`.
    pub fn error(&self) -> Option<ApexError> {
        if !self.compiled {
            Some(ApexError::Compile {
                message: self.compile_problem.clone().unwrap_or_default(),
                line: self.line,
                column: self.column,
            })
        } else if !self.success {
            Some(ApexError::Runtime {
                message: self.exception_message.clone().unwrap_or_default(),
                stack_trace: self.exception_stack_trace.clone(),
            })
        } else {
            None
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p features anon_apex::tests`
Expected: PASS (3 tests).

(No commit yet.)

---

### Task 3: run_anon — orchestration via run_raw + envelope handling

**Files:**
- Modify: `crates/features/src/anon_apex.rs`

**Interfaces:**
- Consumes: `sf_core::{SfInvoker, SfError}`, `serde_json`, `std::fs`,
  `std::env::temp_dir`.
- Produces: `pub async fn run_anon(invoker: &SfInvoker, apex_src: &str) ->
  Result<AnonApexOutcome, SfError>`.

- [ ] **Step 1: Write the failing test**

Add inside the existing `mod tests` block in `crates/features/src/anon_apex.rs`
(after the model tests). These use `MockRunner::new` so we can inspect the args
(`apex run -f <file>`) and return arbitrary envelope status:

```rust
    use sf_core::runner::{MockRunner, RawOutput};
    use sf_core::SfInvoker;
    use std::sync::Arc;

    fn invoker_returning(status: i32, stdout: &str) -> SfInvoker {
        let stdout = stdout.to_string();
        SfInvoker::new(Arc::new(MockRunner::new(move |program, args| {
            assert_eq!(program, "sf");
            assert_eq!(args[0], "apex");
            assert_eq!(args[1], "run");
            assert_eq!(args[2], "-f");
            assert!(args.iter().any(|a| a == "--json"));
            // the temp file must exist while sf "runs"
            assert!(
                std::path::Path::new(&args[3]).exists(),
                "temp file should exist during run"
            );
            Ok(RawOutput {
                status,
                stdout: stdout.clone(),
                stderr: String::new(),
            })
        })))
    }

    #[tokio::test]
    async fn run_anon_success_envelope_parses_result_and_log() {
        let log = "67.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO\\n\
16:00:00.0 (10)|EXECUTION_STARTED\\n\
16:00:00.0 (50)|EXECUTION_FINISHED\\n";
        let stdout = format!(
            r#"{{"status":0,"result":{{"compiled":true,"success":true,
            "compileProblem":"","exceptionMessage":"","exceptionStackTrace":"",
            "line":null,"column":null,"logs":"{log}"}}}}"#
        );
        let invoker = invoker_returning(0, &stdout);
        let out = run_anon(&invoker, "System.debug('x');").await.unwrap();
        assert!(out.result.success && out.result.compiled);
        let view = out.log_view.expect("log_view should be Some");
        assert_eq!(view.header.as_ref().unwrap().api_version, "67.0");
    }

    #[tokio::test]
    async fn run_anon_compile_failure_envelope_uses_data() {
        let stdout = r#"{"status":1,"name":"executeCompileFailure",
            "data":{"compiled":false,"success":false,
            "compileProblem":"Unexpected token 'x'.","exceptionMessage":"",
            "exceptionStackTrace":"","line":"1","column":"9","logs":""}}"#;
        let invoker = invoker_returning(1, stdout);
        let out = run_anon(&invoker, "x").await.unwrap();
        assert!(!out.result.compiled);
        assert_eq!(out.result.line, Some(1));
        assert_eq!(out.result.column, Some(9));
        assert!(out.log_view.is_none());
        match out.result.error().unwrap() {
            ApexError::Compile { message, .. } => assert!(message.contains("Unexpected")),
            other => panic!("expected Compile, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn run_anon_genuine_error_envelope_is_sf_error() {
        let stdout = r#"{"status":1,"name":"Error","message":"socket hang up"}"#;
        let invoker = invoker_returning(1, stdout);
        let err = run_anon(&invoker, "x").await.unwrap_err();
        match err {
            SfError::Command { status, name, message } => {
                assert_eq!(status, 1);
                assert_eq!(name, "Error");
                assert!(message.contains("socket hang up"));
            }
            other => panic!("expected SfError::Command, got {other:?}"),
        }
    }
```

Note the `\\n` in the Rust string above is a literal backslash-n inside the JSON
string the mock returns (valid JSON escape), so `logs` deserializes to real
newlines that `DebugLogView::from_log` can parse.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p features anon_apex::tests::run_anon_success_envelope_parses_result_and_log`
Expected: FAIL — `run_anon` not found.

- [ ] **Step 3: Write minimal implementation**

Add `use sf_core::{SfError, SfInvoker};` to the top-of-file imports, and add
(above the test module):

```rust
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Execute anonymous Apex from `apex_src`.
///
/// Writes the source to a unique temp file, runs `sf apex run -f <file> --json`
/// via `run_raw` (so a non-zero compile-failure exit still yields its payload),
/// parses the envelope, and always deletes the temp file.
pub async fn run_anon(invoker: &SfInvoker, apex_src: &str) -> Result<AnonApexOutcome, SfError> {
    let path = unique_temp_path();
    std::fs::write(&path, apex_src).map_err(SfError::Spawn)?;

    let path_str = path.to_string_lossy().into_owned();
    let raw = invoker
        .run_raw(&["apex", "run", "-f", &path_str, "--json"])
        .await;

    let _ = std::fs::remove_file(&path); // best-effort cleanup, even on error

    let raw = raw?;
    let result = parse_run_envelope(&raw.stdout)?;
    let log_view = (!result.logs.is_empty()).then(|| DebugLogView::from_log(&result.logs));
    Ok(AnonApexOutcome { result, log_view })
}

/// Parse the `sf apex run` envelope: `status==0` → `result`; non-zero compile
/// failure carries the same shape in `data`; otherwise a genuine `SfError`.
fn parse_run_envelope(stdout: &str) -> Result<ApexRunResult, SfError> {
    let env: serde_json::Value = serde_json::from_str(stdout).map_err(SfError::Parse)?;
    let status = env.get("status").and_then(|v| v.as_i64()).unwrap_or(0);

    let payload = if status == 0 {
        env.get("result")
    } else {
        // compile failure: payload lives in `data` and carries `compiled`
        env.get("data").filter(|d| d.get("compiled").is_some())
    };

    match payload {
        Some(p) => serde_json::from_value(p.clone()).map_err(SfError::Parse),
        None => Err(SfError::Command {
            status: status as i32,
            name: env
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Error")
                .to_string(),
            message: env
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
        }),
    }
}

/// A process-unique temp path under the system temp dir.
fn unique_temp_path() -> std::path::PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("sf-toolkit-anon-{}-{nanos}-{n}.apex", std::process::id()))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p features anon_apex::tests`
Expected: PASS (6 tests: 3 model + 3 run_anon).

(No commit yet.)

---

### Task 4: gated e2e test against staging

**Files:**
- Create: `crates/features/tests/anon_apex_e2e.rs`

**Interfaces:**
- Consumes: the crate's public `anon_apex` API + `sf_core::{SfInvoker,
  ProcessRunner}`.
- Produces: a `#[ignore]`-d integration test running real `sf` end to end.

- [ ] **Step 1: Write the e2e test**

`crates/features/tests/anon_apex_e2e.rs`:

```rust
//! End-to-end test against the live default org (staging sandbox).
//! Ignored by default; run with:
//!   cargo test -p features --test anon_apex_e2e -- --ignored

use features::anon_apex::run_anon;
use sf_core::{ProcessRunner, SfInvoker};
use std::sync::Arc;

#[tokio::test]
#[ignore = "hits the live org; run explicitly with --ignored"]
async fn e2e_run_anon_debug() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));

    // Read-only: a single debug statement, no DML.
    let out = run_anon(&invoker, "System.debug('sf-toolkit-e2e');")
        .await
        .expect("sf apex run");

    assert!(out.result.compiled, "should compile");
    assert!(out.result.success, "should run successfully");
    assert!(!out.result.logs.is_empty(), "should return a debug log");
    let view = out.log_view.expect("log_view should be Some");
    assert!(view.header.is_some(), "parsed log should have a header");
    assert!(out.result.error().is_none(), "no error on success");
}
```

- [ ] **Step 2: Verify it compiles and is skipped by default**

Run: `cargo test -p features`
Expected: all unit tests pass (soql + debug_log + anon_apex); the e2e test shows
as `ignored` (not run).

- [ ] **Step 3: Full verification**

Run:
```bash
cargo test -p features \
  && cargo clippy -p features --all-targets -- -D warnings \
  && cargo fmt -p features \
  && cargo fmt --all --check
```
Expected: unit tests PASS, e2e ignored, clippy clean, fmt clean.

- [ ] **Step 4: Commit (single feature commit for the whole module)**

```bash
git add crates/features
git commit -m "feat(features): anonymous apex execution with compile/runtime/log view"
```

Note: the controller runs `cargo test -p features --test anon_apex_e2e -- --ignored`
after merge as the post-stage e2e verification (per the standing project rule).

---

## Self-Review

- **Spec coverage:** `ApexRunResult` + tolerant `line`/`column` + empty→None +
  `error()` (T2), `AnonApexOutcome` / `ApexError` (T2), `run_anon` via
  `run_raw` + manual envelope with temp-file write/cleanup (T3), `log_view`
  reuse of `DebugLogView::from_log` (T3), gated e2e (T4), module wiring (T1).
  Trace-flag/debug-level config, SP-F syntax editing, streaming correctly
  deferred.
- **Placeholder scan:** every step has complete code + exact commands; no TBD.
- **Type consistency:** `SfInvoker`/`SfError`/`MockRunner`/`RawOutput` from
  sf-core (names match shipped API: `run_raw` returns `RawOutput{status,stdout,
  stderr}`; `SfError::{Command{status,name,message},Parse,Spawn}` exist).
  `DebugLogView::from_log` reused from `crate::debug_log` (this crate, SP-A).
  `MockRunner::new(|program,args| -> Result<RawOutput,SfError>)` signature
  matches sf-core.
- **Decision deviations (flagged):** the spec's §Model defines `ApexRunResult`
  in the `anon_apex` module; this shadows the pre-existing
  `sf_core::models::ApexRunResult`. We keep them separate intentionally — the
  sf-core one is non-`Option` and cannot represent string `line`/`column` or
  empty-vs-absent. The sf-core type stays untouched (pre-existing; not in this
  slice's scope to remove).
- **Single feature commit:** unlike SP-A/SP-B's per-task commits, this slice
  ships as one `feat(features)` commit (scaffold + model + run_anon + e2e)
  because the placeholder module does not compile standalone in a meaningful
  way and the slice is small; the plan-doc commit is separate and first.
