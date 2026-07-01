# Apex Log Analysis — charts / visualization recommendations

Companion to `apex-log-insights.md` (rule-based findings list). That doc owns the
"tell me the problem" angle; this one owns **visualization**. They're complementary.

## What the field actually charts (researched)

**Apex Log Analyzer / "Lana"** (Certinia, the VS Code gold standard) ships only two
genuinely *chart*-shaped views — everything else is a sortable table:

1. **Timeline flame chart** — the headline. Every METHOD/SOQL/DML/callout as a
   horizontal bar; x = elapsed time, y = call depth; colored by event type; minimap +
   zoom/pan for 500k-line logs.
2. **Governor Limits strip** — at-a-glance used/max bars with traffic-light coloring,
   expandable to a per-step chart.

Call Tree, Apex Analysis, Database Analysis = tables (self/total time, rows, counts),
not charts. IC2 is the same (tree-table). So the bar for "add charts" is low: 2 chart
types cover the whole market.

## We already parse everything needed

| Chart | Source DTO (already exists) |
|-------|-----------------------------|
| Flame timeline | `tree.rs` `ExecNode { dur_ns, self_ns, children, entry }` — has depth + span |
| Governor limit bars | `limits.rs` `LimitRollup { entries: LimitEntry{ used, max, name } }` |
| Hotspot bar chart | `profile.rs` `Hotspot { signature, self_ns, total_ns, count, self_bytes }` |
| Time-breakdown bar | events: SOQL/DML/callout/heap durations (`event.rs`) |

No parser work required for any of these.

## Recommendations (ranked by value ÷ effort)

1. **Governor Limits bars — do first.** `<div style="width:{used/max*100}%">` +
   green/amber/red at 60/90% (reuse `limitSeverity` from the insights doc). Zero deps,
   ~an afternoon, immediately useful. Highest ROI.
2. **Hotspots horizontal bar chart.** Top-N methods by `self_ns`; bar width = share of
   total. Also plain CSS. Turns the existing Hotspots table into a glanceable ranking.
3. **Time-breakdown stacked bar** (one row: Apex vs SOQL vs DML vs callout). One flex
   row of colored segments. Answers "where did the time go?" in a glance.
4. **Timeline flame chart — the real feature.** Stacked bars from `ExecNode`
   (x=start/dur, y=depth), color by event type, click → jump to Raw/Tree. This is the
   one worth real effort; it's what makes a *log analyser*.
5. **Query-family bars** (pt-query-digest style) — SOQL grouped by fingerprint, ranked
   by total time. Ties directly into the fingerprinting work in `apex-log-insights.md`.

## Library choice

- Items 1–3, 5 are `width: {pct}%` bars — **no chart library.** Adding recharts/d3 for a
  CSS bar is exactly the over-engineering to avoid (repo currently has zero chart deps;
  keep it that way for these).
- Item 4 (flame chart) is the only thing that *might* justify a dep:
  - **Start hand-rolled SVG** — fine up to a few thousand nodes, no dep, matches the
    current stack. Ship this first.
  - **Escalate to canvas only if** real logs stutter. Then reach for **uPlot** (~40kB,
    canvas, very fast) or a canvas flame renderer — not d3-flame-graph (drags in all of
    d3). Decide with a perf measurement, not upfront.

## Suggested order

Limits bars → Hotspots bars → time-breakdown → (measure) → SVG flame timeline →
query-family bars. First three are near-free and land visible wins; flame chart is the
one deliberate investment.
