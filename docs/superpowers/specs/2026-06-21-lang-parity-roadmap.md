# feature parity roadmap (SOQL / Anonymous Apex / Log analysis)

> Date: 2026-06-21 · Status: In progress · Driven by the that plugin gap analysis.
> Goal: bring SOQL query, Anonymous Apex, and Debug-log analysis to **basic parity** with
> the established Salesforce IDE plugin. Each item lands as its own tested + e2e-verified increment via /loop.

## Baseline (from the gap analysis)

- **SOQL ~70%**: authoring (completion/diagnostics/results/tabs/history) at parity; gaps are
  execution-side power + editor sugar.
- **Anonymous Apex**: core run/log-levels/inline-log/completion at parity; gaps are
  post-execution analysis (offline debugger, AER eval) + small wins.
- **Log analysis ~30-40%**: structural foundation (exec tree, limits, 3 view tabs); the entire
  profiling layer is missing and event coverage is ~20/140.

## Priority backlog

### Log analysis (largest gap, highest analytical value)
1. **Self vs total duration** — ✅ DONE. `ExecNode.self_ns` (total − children), surfaced in the
   Tree view.
2. **Aggregate hotspots** — ✅ DONE. `profile::hotspots` groups method/unit frames by
   signature, sums self/total time + call count; a "Hotspots" tab shows top methods by self time.
3. **Heap allocation tracking** — ✅ DONE. `HEAP_ALLOCATE` recognized; per-frame self heap
   aggregated into hotspots (HEAP column), mirroring that plugin's Self Heap.
4. **SOQL/DML detail + row counts** — ✅ DONE. `statements::statements` extracts SOQL/DML
   text + rows + duration; a "Queries" tab groups by text (count + rows) and flags repeats (N+1).
5. **Event-filterable tree** — ✅ DONE. `filterTree` prunes the execution tree
   to matching events (label/detail); filter box on the tree tab. Unit + e2e.
   (Remaining: broader event-name coverage toward that plugin's ~140 — low-value mechanical.)
6. **Open local `.log` / save downloaded log** — ✅ DONE. `parse_log` command
   (shares `build_log_view` with `get_log`, no org fetch); LogsPanel OPEN/SAVE
   buttons via dialog + fs. Unit-covered parsing + e2e for the open flow.

### SOQL (operational power features)
1. **CSV export of results** — ✅ DONE. `csv::toCsv` (RFC 4180) + Export button in
   `ResultTable` → native save dialog → `writeTextFile`. Unit + e2e covered.
2. **Tooling API toggle** — ✅ DONE. Per-tab "Tooling API" checkbox →
   `run_query(..., use_tooling_api)` adds `--use-tooling-api`. Unit + e2e covered.
3. **Query EXPLAIN / plan** — ✅ DONE (pending live-org verification). "Explain"
   button → `query_plan` via `sf api request rest .../query/?explain=` →
   `QueryPlanView` (cost/cardinality/leading-op, non-selective in red). Unit +
   e2e covered; `sf api request rest` raw-body shape not yet live-tested.
4. **Governor/result-set validations + add-LIMIT quickfix** — ✅ DONE.
   `soql_lang::missing_limit` warns on unbounded queries (schema-free, fires
   offline); Monaco "Add LIMIT 200" quickfix via `limitInsertion`. Unit-covered.
5. **SOQL formatter** — ✅ DONE. `soql_lang::format_soql` (clause-per-line,
   depth-aware) wired to Monaco Format Document.
6. **queryAll / `--all-rows` toggle** — ✅ DONE. Per-tab "All rows" checkbox →
   `QueryOptions { all_rows }` (refactored away the 2-bool param smell). Unit + e2e.
7. **Date-literal completion** — ✅ DONE. `SOQL_DATE_LITERALS` offered in
   WHERE/HAVING (TODAY, LAST_N_DAYS:, …). Functions already covered.
   Bind-variable (`:apexVar`) completion — ✅ DONE. Inside Apex `[SELECT … :x]`,
   completing after `:` offers in-scope Apex vars (`scope_names_at`). Remaining: TYPEOF (very niche).

### Anonymous Apex
1. Run-history panel — ✅ DONE (already implemented). `ApexPanel` records
   `tool: "apex"` runs; `HistoryDrawer` surfaces them; `requestOpenTab("apex")`
   reopens into a scratch tab.
2. Default-namespace execution toggle.
3. (Large) Offline/checkpoint debugger — step-through with stack/heap/variable inspection.
4. (Large, depends on 3) AER expression / watch evaluation.

## Notes / corrections

- The gap analysis flagged a supposed "anon Apex doesn't target the selected org" bug — **false**.
  `run_apex` already threads `current_org(&state)` → `run_anon` (shared `AppState.selected_org`,
  same as every command); `run_anon_forwards_target_org` covers it.

## Process

Each increment: branch → (spec if non-trivial) → TDD → `cargo test --workspace` + clippy
`-D warnings` + `cargo fmt --check` + desktop tsc/vitest + Playwright e2e → commit → merge.
