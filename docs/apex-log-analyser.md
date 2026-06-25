# Apex Debug Log: from viewer to analyser

Goal: make the Apex-log feature a **diagnostics engine**, not just a viewer.
This doc tracks the current state, how it compares to Illuminated Cloud 2 (IC2),
and a prioritized roadmap. Driven iteratively via `/loop`.

## Current state (already ahead of IC2 in places)

Frontend `desktop/src/panels/LogsPanel.tsx` already has 5 tabs:

- **Tree** — nested execution tree, self/total time, text filter
- **Hotspots** — methods/units ranked by self-time
- **Queries** — SOQL/DML grouped by text → **N+1 detection** (IC2 lacks this)
- **Limits** — governor-limit rollup per namespace
- **Raw** — colored log (exceptions/USER_DEBUG/limits) + search

Backend: `list_logs` / `get_log` / `parse_log` → `LogViewDto { raw, api_version,
units[] }`; each `UnitDto { tree, hotspots, statements, limits }`. The
`log-parser` crate already extracts 24 event types, method entry/exit tree with
ns timing + self-time, SOQL/DML text+rows+timing, heap bytes, and governor
limits per namespace.

## IC2 comparison

IC2 = structured tree-table viewer + profiling columns (self/total CPU & heap),
smart auto-expand of hot frames, caller/callee aggregation, 7+ predefined
profiling views. **Missing in IC2**: N+1 detection, limits dashboard,
timeline/flame graph, free-text search beyond views, exception summary, log
comparison. We already beat it on N+1, hotspots, limits rollup, and raw search.

## Gaps & roadmap (data mostly already parsed — no parser rewrite needed)

Priority order (value × low risk):

1. **Limits dashboard** ✅ (done) — usage % bars, severity colors, ranked
   tightest-first. `limitStats.ts` + `LimitsView`.
2. **Query hotspot ranking** ✅ (done) — Queries tab now ranks grouped
   statements by **total DB time** (not just count), adds a TIME column and
   total SOQL/DML time in the header. `queryStats.ts` (+3 tests). Also fixed a
   stray NUL byte that was in the old grouping key (made the file read as
   binary to grep).
3. **Insights / diagnostics panel** ⭐ — an "Insights" tab that runs rule-based
   detectors and lists ranked findings with a why+fix. Design + field research
   (Lana / IC2 / ApexGuru) + cross-domain techniques in `apex-log-insights.md`.
   - ✅ (done, phase 1) `soqlFingerprint.ts` (+tests), `insights.ts` detectors:
     **SOQL/DML-in-loop (by fingerprint)**, **repeated method**, **recursion /
     recursive trigger**, **governor-limit near-breach**, all pure + 7 unit
     tests; `InsightsView` tab wired into LogsPanel (default-visible).
   - ✅ (phase 2) **critical-path** finding (descend longest child; reports the
     dominant chain + hottest self-time node) and **large/slow-query** detector
     (high rows / slow, skips in-loop dups). insights tests now 10.
   - ✅ (phase 3) **exception summary** — cross-stack: `log-parser/exceptions.rs`
     extracts EXCEPTION_THROWN/FATAL_ERROR → `UnitView.exceptions` → `ExceptionDto`
     → `detectExceptions` (grouped by message, fatal=crit, ×count). insights
     tests 12; log-parser +1.
   - ✅ (phase 4) **loop-body / motif detection** — pure-frontend `detectLoopBody`
     flags a node whose children repeat the same label consecutively (a loop
     body), pinpointing *where* the loop is and catching loops below the global
     repeated-method threshold. insights tests 13.
   - ✅ (phase 5) **finding navigation** — each Insights finding links to the
     tab holding its evidence (loop/slow query→Queries, limit→Limits,
     recursion/loop-body/critical-path→Tree, exception→Raw) via a "View →"
     button. e2e covers the jump. (Note: build_tree keeps Leaf events incl.
     CALLOUT_REQUEST/USER_DEBUG as tree nodes, so callout-in-loop is already
     caught by loop-body and near-limit callouts by the limits detector — a
     separate callout detector would be redundant.)
   - ✅ (phase 6) **USER_DEBUG "Debug" tab** — `collectUserDebug` walks the trees
     for USER_DEBUG nodes; a new Debug tab lists them in order, away from raw-log
     noise. `debugLines.ts` (+2 tests), e2e `apex-debug.spec.ts`.
   - ✅ (phase 7) **log A/B diff** — pure engine `logDiff.ts` (`diffLogs(a, b)`:
     query families by fingerprint, limits, totals with A→B deltas, biggest
     change first; +4 tests) AND the compare UI: a **Compare** button loads a
     baseline log, a **Diff** tab renders query/limit changes (red = regression,
     green = improvement) + an A→B summary; baseline clears when the primary log
     changes. e2e `apex-diff.spec.ts`.
   - ✅ (phase 8) **jump to source** — clicking a method in the call tree or a
     hotspot fetches the Apex class/trigger source from the org via the Tooling
     API (`fetch_apex_source`) and shows it read-only with the target line
     highlighted (`SourceDialog`, `sourceRef.ts` +4 tests). e2e
     `apex-source.spec.ts`. (No local workspace checkout needed — fetched live.)

**Status: analyser roadmap complete.** Optional future polish: Lana-style
Aggregated/Bottom-Up call-tree modes, a flame-graph timeline, AI-assisted
explanations.
4. **Tree smart auto-expand + collapse** ✅ (done) — `TreeNode` is now
   collapsible with a chevron; the hot path auto-expands (a child ≥50% of its
   parent's duration), cheap branches start collapsed, and an active filter
   force-expands so matches aren't hidden. e2e `apex-tree.spec.ts`. (Lana's
   Aggregated / Bottom-Up call-tree modes still optional, later.)
4. **Exception summary** — structured panel: each EXCEPTION_THROWN / FATAL_ERROR
   with message + where in the call tree (needs DTO to surface exception params).
5. **Callout analytics** — dedicated view: count, total/avg duration, endpoints
   (parser already has CALLOUT_REQUEST/RESPONSE as tree nodes).
6. **USER_DEBUG panel** — structured debug-print list with timeline, separate
   from raw search.
7. **Flame graph** — visual call tree (width = duration) for bottleneck spotting.
8. **Log comparison (A/B)** — diff two logs for perf regressions.

Items 1–3, 6 are frontend-only on existing DTOs. 4–5 need small DTO additions in
`dto.rs` (surface exception text / callout params). 7–8 are larger.
