# features::anon_apex (SP-C thin slice) — design

> Date: 2026-06-18 · Status: Approved · Crate: `crates/features` (module `anon_apex`) · Depends on: sf-core, log-parser

## Purpose

Execute anonymous Apex and surface the result + debug log + error location.
Reuses the SP-A `DebugLogView` for the log. Mirrors the SP-A/SP-B pattern: thin
`sf` orchestration + pure projection, MockRunner unit tests + a gated e2e.

Scope (thin slice): run a source string, return a typed result, parse its logs
into a `DebugLogView`, and expose compile/runtime error location. **Deferred**:
trace-flag/debug-level configuration, syntax-aware editing (SP-F), streaming.

## Verified `sf` API shapes (pre-checked against staging, sf 2.127)

`sf apex run -f <file> --json` — anonymous Apex is passed via a file (`-f`).
Three outcomes:

1. **Success / runtime exception → envelope `status: 0`**, `result` =
   `{ compiled: bool, success: bool, compileProblem: string, exceptionMessage:
   string, exceptionStackTrace: string, line: number|null, column: number|null,
   logs: string }`. (`success:false` with an `exceptionMessage` = compiled but
   threw at runtime; `logs` holds the debug log text.)
2. **Compile failure → envelope `status: 1`, `name: "executeCompileFailure"`**,
   and the SAME result shape lives in **`data`**, e.g.
   `{ success:false, compiled:false, compileProblem:"Unexpected token 'x'.",
   line:"1", column:"9", logs:"" }`. NOTE `line`/`column` are **strings** here.
3. **Genuine CLI/transport error → `status: 1`, `name: "Error"`**, no
   `data.compiled` (e.g. network/TLS). Surface as `SfError`.

Because compile failures exit non-zero with the payload in `data`, `run_json`
(which maps non-zero status to `SfError::Command`) is unusable here — use
`run_raw` + custom envelope handling.

## Model

```rust
pub struct ApexRunResult {
    pub compiled: bool,
    pub success: bool,
    pub compile_problem: Option<String>,      // serde "compileProblem"
    pub exception_message: Option<String>,    // "exceptionMessage"
    pub exception_stack_trace: Option<String>,// "exceptionStackTrace"
    pub line: Option<i64>,                     // string|number|null tolerant
    pub column: Option<i64>,
    pub logs: String,
}
pub struct AnonApexOutcome { pub result: ApexRunResult, pub log_view: Option<DebugLogView> }
pub enum ApexError {              // derived error location for the UI
    Compile { message: String, line: Option<i64>, column: Option<i64> },
    Runtime { message: String, stack_trace: Option<String> },
}
```

`line`/`column` deserialize via a helper accepting JSON string, number, or null
→ `Option<i64>` (empty/blank string → None). Empty `compileProblem`/
`exceptionMessage`/`exceptionStackTrace` strings normalize to `None`.

## Surface

```rust
pub async fn run_anon(invoker: &SfInvoker, apex_src: &str) -> Result<AnonApexOutcome, SfError>;
impl ApexRunResult {
    pub fn error(&self) -> Option<ApexError>; // Compile if !compiled, else Runtime if !success
}
```

`run_anon`: write `apex_src` to a unique temp file, `run_raw(["apex","run","-f",
path,"--json"])`, parse stdout envelope: `status==0` → deserialize `result`;
`status!=0` with `name=="executeCompileFailure"` (or a `data` object carrying
`compiled`) → deserialize `data`; otherwise → `SfError::Command{status,name,
message}`. Always delete the temp file. Build `log_view` =
`(!result.logs.is_empty()).then(|| DebugLogView::from_log(&result.logs))`.

## Decisions

1. **`run_raw` + manual envelope**, not `run_json`: compile errors live in
   `data` on a non-zero exit; `run_json` would discard them.
2. **Reuse `DebugLogView`** (SP-A) for the log — no new log handling.
3. **Tolerant `line`/`column`** (string|number|null) — sf returns strings on
   compile failure, numbers/null otherwise.
4. **Temp-file via `std::env::temp_dir`**, unique name, always cleaned up. No new
   crate (no `tempfile`).

## Testing

- **Unit (MockRunner):**
  - success envelope (status 0, result with a tiny real log) → `outcome.result.
    success`, `compiled`, `log_view` is `Some` with a header.
  - compile-failure envelope (status 1, `name:"executeCompileFailure"`, `data`
    with `compileProblem`, `line:"1"`, `column:"9"`, empty logs) →
    `result.compiled == false`, `line == Some(1)`, `column == Some(9)`,
    `error()` is `ApexError::Compile`, `log_view` is `None`.
  - genuine error envelope (status 1, `name:"Error"`, no `data.compiled`) →
    `Err(SfError::Command { .. })`.
  - `error()` returns `Runtime` when `compiled && !success` with an
    `exceptionMessage`.
- **e2e (gated, `#[ignore]`):** real `sf` against staging:
  `run_anon(invoker, "System.debug('sf-toolkit-e2e');")` → `result.success`,
  `result.compiled`, non-empty `logs`, `log_view` is `Some`. Read-only (a debug
  statement; no DML). Run with `cargo test -p features --test anon_apex_e2e -- --ignored`.
