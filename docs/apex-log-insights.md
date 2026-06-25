# Apex Log Insights — auto-detect problems (the analyser differentiator)

Research-backed design for the feature that makes us an *analyser*, not a viewer:
a panel that **runs detectors over the parsed log and lists actionable findings**
(what's wrong, where, why, how to fix) — instead of leaving the developer to
read aggregations.

## What the field does today (researched)

- **Apex Log Analyzer ("Lana", Certinia, open-source, VS Code)** — the gold
  standard. Timeline flame chart; interactive Call Tree with **three modes —
  Time Order, Aggregated (collapses repeated hot paths), Bottom-Up (caller
  attribution)**; Apex Analysis + Database Analysis tables (duration,
  selectivity, rows, SOQL optimization tips); Governor Limits strip with
  traffic-light coloring; deep search; jump-to-source.
- **IC2** — tree-table + profiling columns + smart auto-expand of hot frames.
- **ApexGuru (Salesforce AI)** — automated discovery of anti-patterns +
  prescriptive fix recommendations.

**Gap:** Lana and IC2 are powerful *aggregating viewers* — they show you the
data and you draw the conclusion. None ships an opinionated "here are your N
problems, ranked, with fixes" list. ApexGuru does (AI, paid, code-side). We can
own this on the **log side, rule-based, local, free** — and it directly answers
the user's examples (a method/SOQL repeatedly run in a loop; recursion / loops).

## Proposed feature: an **Insights** tab

A new tab beside Tree/Hotspots/Queries/Limits/Raw. It renders a ranked list of
**Findings**. Each finding:

- severity dot — `crit` / `warn` / `info`
- one-line title (e.g. "SOQL run 47× — likely inside a loop")
- evidence (count, total time, rows, namespace, location label)
- expandable **why it matters + how to fix**
- (later) click → jump to the offending Tree node / Raw line

Findings ranked by severity, then impact (time/count). Empty state: "No issues
detected ✅".

## Detector catalog (all computable from existing DTOs)

Data already available per unit: `tree` (ExecNode: label, detail, dur_ns,
self_ns, children), `hotspots` (signature, self_ns, total_ns, count), `statements`
(kind, text, rows, dur_ns), `limits` (entries: name, used, max).

1. **SOQL/DML in a loop** (crit) — group statements by text; a group with
   `count ≥ 5` is almost always a query/DML issued inside a loop. Evidence: ×N,
   total ms, rows. Fix: move the query out of the loop / bulkify (query by a Set
   of ids once). This is the headline detector.
2. **Repeated method invocation** (warn) — a hotspot `count ≥ 25` → method run
   in a loop. Fix: bulkify or memoize. (Higher threshold than SOQL; methods are
   legitimately called often.)
3. **Recursion / re-entrancy** (warn/crit) — walk the call tree; if a node's
   signature appears in its own ancestor chain, that's recursion (A→…→A). Report
   the cycle and depth. A re-entered trigger code-unit = the classic recursive
   trigger. Fix: static guard / processed-id set.
4. **Governor limit near breach** (crit ≥ 90%, warn ≥ 60%) — reuse
   `limitStats.limitSeverity`. Evidence: used/max, %. Surfaces the *tightest*
   limit as a finding, not just a table row.
5. **Large / slow query** (warn) — a statement with `rows ≥ 2000` (selectivity /
   heap risk) or `dur_ns` above a threshold. Fix: add filters / selective index /
   LIMIT.
6. **Many total queries/DML** (warn) — total SOQL count approaching the 100/150
   limit even if no single query loops.

Later (needs small parser/DTO additions): non-selective query flag, heap growth
trend, uncaught exception summary.

## Cross-domain techniques applied (observability / DB / log mining)

Borrowed from outside the Salesforce ecosystem, adapted to Apex logs:

- **Query fingerprinting / normalization** (pt-query-digest, pg_stat_statements).
  Group SOQL/DML by a *fingerprint* — bind literals replaced (`Id = '001x...'` →
  `Id = ?`), `IN (...)` lists collapsed, whitespace normalized — not exact text.
  **Critical fix:** loops usually bind a different id each iteration, so our
  current exact-text grouping *misses* the very SOQL-in-loop we want to flag.
  Fingerprinting catches the whole family. Refines detector #1; also gives a
  clean "query families ranked by total time" (pt-query-digest's core output).
- **Critical Path analysis** (Google Critical Path Tracing, ACM Queue 2022).
  The critical path = the chain of tree nodes that actually determines total
  duration; optimizing off-path work doesn't help wall-clock. Compute it by
  walking from the root always into the child with the largest duration that
  bounds the parent's span. Surface as a finding ("80% of time is on this path")
  and (later) a highlighted path in the Tree. Beats "highest self-time" for
  "where do I optimize?".
- **Repeated-subsequence (motif) detection** (Drain template mining + sequence
  analysis). Mine the child-event sequence under each frame for a consecutive
  repeated subsequence (e.g. `[METHOD_ENTRY X, SOQL, METHOD_EXIT X] × 50`). That
  *is* the loop body — it identifies "this code segment runs in a loop" and the
  iteration count precisely, which is exactly the user's example and stronger
  than per-statement counting. Run-length/motif detection is cheap and
  deterministic (no ML).
- **Differential comparison** (New Relic anomaly-vs-similar-traces; CPT's
  "compare a fast trace with a slow one"). Powers the later log A/B feature:
  diff two logs' critical paths / query families / limits to spot regressions.
- **Skip ML log anomaly detection** (DeepLog/LogBERT/LSTM). Powerful but needs
  training data + is non-deterministic; the rule + fingerprint + motif approach
  is the pragmatic, explainable transfer for a local desktop tool.

These mostly *strengthen* the detectors rather than add UI: fingerprinting and
motif detection make the loop/recursion findings far more accurate; critical
path is one new finding (+ optional Tree highlight); differential feeds the
comparison roadmap item.

## Design notes

- Pure function `detectInsights(units: UnitDto[]): Finding[]` in
  `desktop/src/panels/insights.ts` — no React, fully unit-testable (vitest, node
  env), like `limitStats.ts` / `queryStats.ts`.
- `Finding = { severity; kind; title; detail; fix; sortKey }`.
- Thresholds are constants up top (tunable); start conservative to avoid noise.
- Reuses `groupStatements` (loop/SOQL) and `limitSeverity` (limits).
- Recursion needs a tree walk tracking ancestor labels — the one new bit of
  logic; unit-test with a small synthetic tree (A→B→A).

## Approaches considered

- **A (chosen): rule-based local detectors + Insights tab.** Fast, offline,
  explainable, builds on existing DTOs. Matches user's concrete asks.
- B: AI/LLM-judged insights (ApexGuru-style). Powerful but needs a model call,
  cost, latency, and is non-deterministic — defer; could layer on top later.
- C: just add Lana's Aggregated/Bottom-Up call-tree modes. Useful but still a
  viewer; doesn't *tell* the user the problem. Worth doing later as a complement.

## Roadmap impact

This becomes the top analyser item. Implement order:

1. `soqlFingerprint(text)` helper (strip bind literals, collapse `IN` lists +
   whitespace) + tests — the foundation for accurate loop/N+1 grouping.
2. `insights.ts` detector framework + detectors **1 (SOQL/DML-in-loop, by
   fingerprint)**, **3 (recursion, tree-walk)**, **4 (limits)** — highest value,
   pure, fully unit-testable.
3. Insights tab UI (ranked findings, why+fix, empty state).
4. Detectors 2 (repeated method), 5 (large/slow query), 6 (total counts) +
   **critical-path** finding.
5. Later: motif/loop-body detection, jump-to-source, log A/B differential.

Tracked in `apex-log-analyser.md`.
