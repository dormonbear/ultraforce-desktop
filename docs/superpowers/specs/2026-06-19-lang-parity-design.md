# feature parity (Tier A) — SOQL & Anonymous Apex desktop polish — Design

> Date: 2026-06-19 · Status: Approved (design) · Stack: Tauri 2 + React 19 + Tailwind v4
> Reference: the established Salesforce IDE plugin SOQL Query + Anonymous Apex screens.

## Goal & scope

Bring the existing Tauri desktop SOQL and Anonymous Apex panels to that plugin "look & feel"
parity for the **achievable** feature set, without the two heavy deferred engines.

**In scope (4 units):**
1. Global org selector (real `sf org list`, target-org threaded into every sf call).
2. SOQL result: status line (`Executing…` / `N rows returned`) + `Table | Tree` toggle (parent-child / subquery tree).
3. Apex/debug log view: per-event syntax highlight, USER_DEBUG emphasis, filter row (search + Debug Only + Highlight).
4. Visual fidelity to that plugin within the existing `desktop-design-system` tokens.

**Out of scope (future rounds):** Apex code autocomplete (apex-lang / SP-F), trace-flag /
log-level config row, multi-tab queries.

## Design-system alignment (UI/UX Pro Max)

Confirms the existing direction — no restyle: Dark Mode (OLED), JetBrains Mono, accent
green `#22C55E` for Run, red `#EF4444` destructive. Applied rules: visible focus rings +
keyboard nav (org dropdown), active-state highlight for current org, tabular numbers for
counts, loading state when an op exceeds ~300ms, **color-not-only** (log tokens keep their
text label, color is secondary; colored tokens ≥4.5:1 on dark bg), debounced search input,
single Lucide icon family, 150–300ms transitions, `prefers-reduced-motion` respected,
`cursor-pointer` + `aria-label` on icon-only controls.

---

## Unit 1 — Global org selector

**What it does:** lists usable orgs and lets the user pick the target org for all sf calls.

**Rust (src-tauri):**
- `AppState` gains `selected_org: std::sync::Mutex<Option<String>>` (username; `None` = sf default).
- New commands:
  - `list_orgs() -> Vec<OrgDto>` where `OrgDto { username, alias: Option<String>, instance_url: Option<String>, is_default: bool }`, via `sf_core::OrgRegistry::list`.
  - `set_target_org(username: Option<String>)` — writes `selected_org`.
- **target-org threading (features API change, additive):** add `target_org: Option<&str>`
  as the last parameter to `features::soql::{run_query, run_query_table}`,
  `features::anon_apex::run_anon`, `features::debug_log::{list_logs, get_log_body, fetch_and_parse}`.
  When `Some(user)`, the function appends `--target-org <user>` to the sf args; when `None`,
  args are unchanged (sf uses its own default). Every existing test keeps passing by
  passing `None`; new tests assert the flag is appended when `Some`.
- Each tauri command reads `selected_org` (clone out of the mutex) and passes it through.

**React:** `OrgSelector` component in the top bar replaces the static chip. Globe (Lucide)
icon + button showing `alias ?? username`; click opens a menu of orgs (default marked,
current highlighted — `nav-state-active`). On select → `invoke("set_target_org", …)` +
local state. Loads via `list_orgs` on mount; disabled/empty state ("no orgs — run `sf org login`") when none.

**Errors:** `list_orgs` failure → selector shows an error affordance, panels still render.

**Test:** MockRunner asserts `--target-org <user>` appended when set and absent when `None`;
`list_orgs` maps the three org categories (reuses sf-core OrgRegistry, already tested).

## Unit 2 — SOQL status line + Table/Tree toggle

**What it does:** shows execution status and lets the result be viewed as a flat table or a
relationship tree (parent lookups + child subqueries).

**Rust (src-tauri):** extend `run_soql` to call `features::soql::run_query` (raw) once and
derive both shapes, returning:
```
SoqlResultDto {
  columns: Vec<String>,
  rows: Vec<Vec<String>>,      // flat table (existing projection)
  total_size: u64,             // REAL QueryResult.total_size (fixes rows.len() bug)
  done: bool,
  tree: Vec<RecordDto>,        // raw record tree for the Tree view
}
RecordDto { sobject_type: String, fields: Vec<FieldDto> }
FieldDto { name: String, value: FieldValueDto }
FieldValueDto = Null | Scalar(String) | Parent(RecordDto) | Children(Vec<RecordDto>)
```
Mapped from `features::soql::{QueryResult, Record, FieldValue}` (which already models
`Parent`/`Children`). Mapping lives in `src-tauri/src/dto.rs`.

**React:** `SoqlPanel` result area gets:
- a thin **status line**: while running `Executing…`; on success `N rows returned`
  (tabular numbers); on error the existing red box.
- a **`Table | Tree`** toggle (active-state styled like the rail). Table = existing
  `ResultTable`. Tree = new `RecordTree`: each record an expandable node
  (`sObjectType` label + field count); fields listed `name: value`; `Parent` nests one
  record, `Children` nests a list; chevron affordance (icon, not color-only), keyboard
  expand/collapse, focus rings. Empty → "— no rows —".

**Test:** Rust unit tests for the `Record → RecordDto` recursion (parent nesting, children
list, scalar/null) and that `total_size` carries the real value.

## Unit 3 — Log view: highlight + filter

**What it does:** renders a raw Salesforce debug log with per-event coloring and a filter
row; shared by the Apex panel's inline log and the Logs panel raw view.

**React (frontend-only):** new shared `LogView` component taking the raw log string.
- Tokenizes each line on `|`; colors by event token: USER_DEBUG emphasized (accent/blue),
  FATAL_ERROR / EXCEPTION_THROWN red, LIMIT_USAGE / HEAP_ALLOCATE dim, others default.
  Token **text remains visible** (color-not-only); colors meet ≥4.5:1 on the dark surface.
- **Filter row:** search box (debounced substring filter, ~150ms), `Debug Only` checkbox
  (show only USER_DEBUG lines), `Highlight` checkbox (highlight search matches in place).
  Visible labels; monospace; virtualize when the log is large (>~500 lines).
- Replaces the plain `{view.raw}` / inline-log `<pre>` in `ApexPanel` and `LogsPanel`.

**Test:** light — covered by `pnpm build` (types) + existing Rust tests unaffected. Optional
Playwright snapshot deferred (no display in CI here).

## Unit 4 — Visual fidelity

Top bar org dropdown matches that plugin (globe + `Org (user@…)`); Run is green `▶` (accent),
spacing/fonts tightened to the terminal/instrument language already in
`desktop-design-system`. No new tokens; reuse `accent`, `red`, `hair`, `surface`,
`text-dim`, `micro-label`, `tnum`.

---

## Dependency / unit boundaries

- `OrgSelector`, `RecordTree`, `LogView` are independent React components with string/DTO
  inputs — testable and replaceable in isolation.
- The features `target_org` param is the only cross-crate change; it is additive and
  backward-compatible (callers pass `None`).
- src-tauri `dto.rs` owns all DTO mapping (org, soql tree, log already there).

## Testing strategy

- Rust: target-org arg threading (MockRunner), SOQL `Record→RecordDto` mapping,
  `list_orgs` mapping. `cargo test --workspace` + clippy `-D warnings` + rustfmt clean.
- Frontend: `pnpm build` (tsc + vite) green. Live verify via the running `pnpm tauri dev`.
- Coverage target follows global 80%.
