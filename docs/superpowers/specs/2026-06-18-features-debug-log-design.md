# features::debug_log (SP-A vertical slice) — design

> Date: 2026-06-18 · Status: Approved · Crate: `crates/features` (module `debug_log`) · Depends on: sf-core, log-parser

## Purpose

The first feature vertical slice: list debug logs, fetch a log body, and parse
it into a view model (header + per-unit execution tree + governor-limit
rollup). No UI yet — this is the `features` crate that the Tauri desktop UI
will later render. It wires `sf-core` (sf orchestration) to `log-parser`
(pure parsing) end-to-end.

## Verified `sf` API shapes (pre-checked against staging)

- `sf apex list log --json` → `result` is a JSON array of ApexLog records; each
  deserializes into `sf_core::ApexLogRef` (Id, Operation, Status, StartTime,
  LogLength, DurationMilliseconds, Application…).
- `sf apex get log -i <id> --json` → `result` is `[{ "log": "<raw log text>" }]`.

## Surface

```rust
// list recent debug logs
pub async fn list_logs(invoker: &SfInvoker) -> Result<Vec<ApexLogRef>, SfError>;

// fetch one log's raw body by Id
pub async fn get_log_body(invoker: &SfInvoker, id: &str) -> Result<String, SfError>;

// fetch + parse into a view model
pub async fn fetch_and_parse(invoker: &SfInvoker, id: &str) -> Result<DebugLogView, SfError>;

pub struct DebugLogView {
    pub header: Option<LogHeader>,
    pub units: Vec<UnitView>,
}
pub struct UnitView {
    pub tree: Vec<ExecNode>,        // log_parser::tree::build_tree(unit)
    pub limits: Vec<LimitRollup>,   // log_parser::limits::extract_limits(unit)
}
impl DebugLogView {
    pub fn from_log(text: &str) -> DebugLogView; // pure; the parse pipeline
}
```

`from_log` is pure (text → view) and holds the parse pipeline so it is unit-
testable without `sf`. `fetch_and_parse` = `get_log_body` then `from_log`.

## Decisions

1. **Vertical slice = list → get → parse.** Trace flag / debug level CRUD
   (the reference plugin's "configure debug levels") is deferred to the desktop config panel
   (SP-A.4); not in this slice. YAGNI.
2. **`LogBody { log: String }`** is a private serde struct in `features` for the
   `get log` result shape; `list_logs` reuses `sf_core::ApexLogRef` directly.
3. **View model is computed eagerly** in `from_log` (build_tree + extract_limits
   per unit). Fine for log sizes; revisit only if a huge log measurably stalls.

## Testing

- **Unit/integration (MockRunner):** `list_logs` against a recorded
  `sf apex list log` envelope; `get_log_body` against `{result:[{log:"…"}]}`
  (and the empty-result error path); `from_log` against a small inline log
  asserting header + unit + a limit reading.
- **e2e (gated):** a `#[ignore]`-d test that runs the real `sf` against the
  staging org: `list_logs` → take the first Id → `fetch_and_parse` → assert a
  non-empty header and at least one unit. Run explicitly with
  `cargo test -p features -- --ignored` as the post-stage verification. Per
  the standing project rule, e2e runs after the stage is merged.
