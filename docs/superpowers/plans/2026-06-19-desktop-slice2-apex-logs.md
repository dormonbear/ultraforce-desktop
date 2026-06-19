# Desktop slice 2 — Apex runner + Debug Logs (Tauri + React)

> Date: 2026-06-19 · Dir: `desktop/` · Branch: feat/desktop-tauri
> Design contract: specs/2026-06-18-desktop-design-system.md (FOLLOW EXACTLY)
> Reuses: features::anon_apex, features::debug_log (already on this branch)

Makes the left rail functional: SOQL (existing) + **Apex** + **Logs** panels,
switched by the rail. Same instrument design language; reuse existing components.

## Global constraints
- Extend the existing `desktop/` app. Match the current code style and the design
  contract (tokens, JetBrains Mono, Lucide icons, tabular numerals, a11y, no emoji).
- **Refactor for growth**: extract shared bits from `App.tsx` into
  `src/components/` (`MicroLabel`, `RunButton`, shell chrome) and move each tool
  into `src/panels/{SoqlPanel,ApexPanel,LogsPanel}.tsx`. `App.tsx` keeps the shell
  (accent strip, top bar, rail) + an `active` panel state the rail switches.
  The SOQL behavior must remain identical after the refactor.
- Verify: `cd desktop && pnpm build` and `cargo build --manifest-path src-tauri/Cargo.toml`.

### Task 1: src-tauri commands
Add to `src-tauri/src/lib.rs` (reuse the shared `Arc<SfInvoker>` State):
```rust
#[derive(serde::Serialize)]
struct ApexOutcomeDto {
  compiled: bool, success: bool,
  compile_problem: Option<String>, exception_message: Option<String>,
  exception_stack_trace: Option<String>, line: Option<i64>, column: Option<i64>,
  logs: String,
}
#[tauri::command]
async fn run_apex(src: String, state: State<'_, AppState>) -> Result<ApexOutcomeDto, String>;
// → features::anon_apex::run_anon(&invoker, &src); map result fields into the DTO.

#[derive(serde::Serialize)]
struct LogRefDto { id: String, operation: String, status: String, start_time: String, application: String }
#[tauri::command]
async fn list_logs(state: State<'_, AppState>) -> Result<Vec<LogRefDto>, String>;
// → features::debug_log::list_logs(&invoker); map sf_core::ApexLogRef fields.
//   GREP crates/sf-core/src/models.rs for the exact ApexLogRef field names first.

#[derive(serde::Serialize)]
struct LogViewDto { raw: String, api_version: Option<String>, unit_count: usize }
#[tauri::command]
async fn get_log(id: String, state: State<'_, AppState>) -> Result<LogViewDto, String>;
// → body = features::debug_log::get_log_body(&invoker, &id);
//   view = features::debug_log::DebugLogView::from_log(&body);
//   raw = body, api_version = view.header.map(|h| h.api_version), unit_count = view.units.len().
```
Register all three. Commit: `feat(desktop): src-tauri apex + debug-log commands`

### Task 2: shell refactor + panel routing
- Extract shared components; introduce `type ActivePanel = "soql" | "apex" | "logs"`
  in `App.tsx`; rail buttons set it (Schema stays disabled). Render the active
  panel. SOQL panel unchanged in behavior.
- Commit: `refactor(desktop): extract panels and rail routing`

### Task 3: Apex panel
- `src/panels/ApexPanel.tsx`: a Monaco editor (`apex` language id; reuse the
  `sf-dark` theme; highlight a few keywords: System, debug, Integer, String, new,
  for, if, return — keep minimal) with default `System.debug('hello');`. A
  primary `RUN ▸` button + Cmd/Ctrl+Enter → `invoke<ApexOutcomeDto>("run_apex",
  { src })`.
- Result area below the editor: a status strip — `COMPILED` / `SUCCESS` chips
  (accent when true, red when false); if `!compiled` show `compile_problem` with
  `Ln line:column` (amber); if compiled `&& !success` show `exception_message`
  (red) + stack trace (faint, collapsible). Then the **debug log** (`logs`) in a
  monospace scroll area with a "DEBUG LOG" micro-label. Spinner + disabled button
  while pending; error box on reject.
- Commit: `feat(desktop): anonymous apex panel`

### Task 4: Logs panel (list + detail)
- `src/panels/LogsPanel.tsx`: a left list (resizable via react-resizable-panels,
  horizontal) of log rows from `invoke<LogRefDto[]>("list_logs")`, each row: a
  status tick (accent if status=="Success" else red), mono `operation`, right
  uppercase `status`, small `start_time`; selected row = accent left-bar + faint
  accent tint; hairline separators. A `⟳ REFRESH` button in the LOGS micro-label.
- On select: `invoke<LogViewDto>("get_log", { id })` → right pane shows a summary
  header (`API {api_version} · {unit_count} units`) + the `raw` log text in a
  monospace scroll area. Loading spinner; error box on reject; empty states.
- Commit: `feat(desktop): debug logs panel with list and raw view`

## Self-review
- [ ] 3 src-tauri commands compile and reuse the shared invoker; DTO field names
      match the real ApexLogRef (verified by grep).
- [ ] Rail switches SOQL/Apex/Logs; SOQL behavior unchanged after refactor.
- [ ] Apex panel: status chips + error location + debug log; Cmd+Enter runs.
- [ ] Logs panel: list + select + summary + raw, with status colors + selection.
- [ ] Design contract honored (tokens/font/icons/tabular/a11y); no emoji.
- [ ] `pnpm build` + src-tauri `cargo build` green.
