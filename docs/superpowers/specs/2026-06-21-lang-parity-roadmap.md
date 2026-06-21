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
5. **Broader event coverage** (toward that plugin's ~140) + sortable/event-filterable tree-table.
6. **Open local `.log` / save downloaded log.**

### SOQL (operational power features)
1. **CSV export of results** — ✅ DONE. `csv::toCsv` (RFC 4180) + Export button in
   `ResultTable` → native save dialog → `writeTextFile`. Unit + e2e covered.
2. **Tooling API toggle** (query ApexClass etc. via `--use-tooling-api`).
3. **Query EXPLAIN / plan** (cost, cardinality, leading operation).
4. **Governor/result-set validations + add-LIMIT quickfix.**
5. queryAll / include-deleted; TYPEOF / function / bind-variable completion; SOQL formatter.

### Anonymous Apex
1. Run-history panel (history.ts already records — needs UI).
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
