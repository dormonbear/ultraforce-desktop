# Apex Log Visualizations — design spec

Add charts to the Apex debug-log analysis UI. Companion to `apex-log-charts.md`
(research) and `apex-log-insights.md` (findings list, already implemented). This
spec covers four visualizations. Governor-limit bars already exist in `LimitsView`
and are out of scope.

## Context (verified against current code)

- Analysis UI already exists: `desktop/src/panels/LogsPanel.tsx` has a tabbed
  `DetailTab` view with `InsightsView / LimitsView / HotspotsView / QueriesView /
  DebugView` + raw/tree. `HotspotsView` and `QueriesView` are plain tables today.
- DTOs are already exposed to the frontend (`desktop/src-tauri/src/dto.rs`):
  `ExecNodeDto { label, detail, dur_ns, self_ns, children, source }`, `HotspotDto`,
  `StatementDto { kind, text, rows, dur_ns }`, `LimitRollupDto`.
- Pure data modules live in `desktop/src/panels/*.ts` with vitest tests
  (`insights.ts`, `limitStats.ts`, `queryStats.ts`, `logTree.ts`). New data logic
  follows this pattern: pure, node-env testable, no React.
- Per-node start offset exists in the parser (`LogEntry.nanos` = elapsed ns from
  log start) but is **not** currently mapped into `ExecNodeDto`.

## Prerequisite (Rust, one field)

Add `start_ns: u64` to `ExecNodeDto` and set it in `map_node` (`dto.rs`) from
`node.entry.nanos`. Required to position flame-chart rects on the elapsed-time
axis. Add a mapping assertion to the existing `dto.rs` tree test. No parser change.

## Item 1 — Hotspots share bars (small)

Enhance existing `HotspotsView`. Add a background bar in the Method cell, width =
`self_ns / maxSelf` across the merged rows. Pure CSS/inline style, no new module,
no new dependency. Keeps the table; the bar is a visual overlay. Manual verify.

## Item 2 — Time-breakdown strip (small)

- Data: `desktop/src/panels/timeBreakdown.ts` — `timeBreakdown(units: UnitDto[]):
  { category: 'apex'|'soql'|'dml'|'callout'|'other'; ns: number; pct: number }[]`.
  Sum self-time by category. Apex = method + constructor self-time; SOQL/DML/callout
  from statements/tree by kind; remainder = other. Sorted descending; pct of total.
- Component: `TimeBreakdownBar` — one horizontal stacked bar + a small legend
  (category · ms · %). Rendered as a compact strip above the analysis tabs.
- Tests: vitest for `timeBreakdown` (category assignment, pct sums to ~100, empty).

## Item 3 — Query-family bars (small-medium)

- Data: `soqlFingerprint(text: string): string` — strip bind literals
  (`Id = '001...'` → `Id = ?`, numbers → `?`), collapse `IN (...)` lists to
  `IN (?)`, normalize whitespace/case-fold keywords. Placed in `queryStats.ts`
  (or a new `soqlFingerprint.ts` if `queryStats.ts` grows too large). Check whether
  `queryStats.ts` already groups queries; extend it rather than duplicate.
- Grouping: group statements by fingerprint, aggregate `{ fingerprint, sample,
  count, totalNs, totalRows }`, rank by `totalNs`.
- Component: enhance `QueriesView` to show families with a total-time share bar +
  `×count` + rows. Keep a way to see a representative raw query text.
- Reuse: the same fingerprint strengthens the insights SOQL-in-loop detector
  (`insights.ts` currently groups by exact text) — wire it in if low-risk, else
  leave a note; not a blocker for this spec.
- Tests: vitest for `soqlFingerprint` (bind stripping, `IN` collapse, whitespace,
  two loop-bound queries → same fingerprint) and for grouping/ranking.

## Item 4 — Flame timeline (large, full Lana-style)

New `"timeline"` `DetailTab` with a canvas-rendered flame chart. No chart library —
the interactions are bespoke; a generic lib fights the data model.

### Data layer (pure, testable)

`desktop/src/panels/flame.ts`:
- `flameLayout(roots: ExecNodeDto[]): FlameRect[]` — flatten the tree to
  `FlameRect { x: number /*start_ns*/, w: number /*dur_ns*/, depth: number,
  label: string, kind: string, source?: SourceRefDto }`. Nodes with no `dur_ns`
  get a min width at render time, not here.
- Geometry helpers (separate, unit-tested): time↔pixel scale, viewport clamp,
  hit-test (point → FlameRect), minimap density buckets. Keep these free of canvas
  calls so they are testable without a DOM.

### Render layer

`TimelineView` component (canvas):
- x = elapsed ns (toolbar toggle to wall-clock HH:MM:SS.mmm), y = depth rows,
  rects colored by event kind (reuse/extend `eventColor` from `LogView.tsx`).
- Zoom: wheel and alt/option-drag area-zoom. Pan: drag. Keyboard nudge optional.
- Minimap strip: skyline density + viewport lens + click-to-teleport.
- Hover tooltip: label, total/self ms, SOQL/DML counts if derivable.
- Shift-drag: measure the duration between two x positions.
- Click a rect → jump to source via existing `onSource(ref: SourceRef)`; optional
  jump to the raw-log line.
- Perf target: smooth pan/zoom on large logs — cull rects narrower than 1px and
  outside the viewport before drawing.

### Tests

vitest for `flame.ts` layout + geometry/hit-test/minimap helpers. Canvas drawing is
visual: verify manually; add a smoke e2e that opens the timeline tab and asserts the
canvas renders + a click reaches source if cheap.

## Dependencies

None. CSS bars + hand-rolled canvas. Repo stays at zero chart dependencies.

## Out of scope (YAGNI now — tracked in insights doc)

Log A/B differential, motif/loop-body detection, critical-path highlight overlay on
the timeline. Revisit after these four land.

## Implementation order

1. Rust `start_ns` prereq (+ test).
2. Item 1 hotspots bars (fast visible win).
3. Item 2 time-breakdown (`timeBreakdown.ts` + component + tests).
4. Item 3 query fingerprint + family bars (tests).
5. Item 4 flame timeline: `flame.ts` + geometry helpers + tests first, then
   `TimelineView` canvas renderer, then interactions (zoom/pan → minimap → hover →
   measure → click-to-source), then smoke e2e.
