/**
 * Rule-based diagnostics over a parsed Apex log — the "analyser" layer on top of
 * the viewer. Pure functions over the existing DTOs so they're fully unit-
 * testable (no React). Each detector emits ranked, actionable {@link Finding}s.
 */
import type { ExecNodeDto, UnitDto } from "../types";
import { soqlFingerprint } from "./soqlFingerprint";
import { limitSeverity } from "./limitStats";

export type Severity = "crit" | "warn" | "info";

export interface Finding {
  severity: Severity;
  kind: string;
  /** One-line headline. */
  title: string;
  /** Supporting evidence (counts, timing, location). */
  detail: string;
  /** Why it matters / how to fix. */
  fix?: string;
  /** Impact for ranking within a severity (higher first). */
  sort: number;
}

/** A statement repeated at least this many times is treated as in-a-loop. */
const LOOP_STMT_MIN = 5;
/** A method invoked at least this many times is flagged as a possible loop. */
const LOOP_METHOD_MIN = 25;
/** Same node repeated this many times consecutively under one parent = a loop body. */
const LOOP_BODY_MIN = 5;
/** A single query returning at least this many rows is "large" (heap/selectivity risk). */
const ROWS_BIG = 2000;
/** A single query taking at least this long (ns) is "slow" (likely non-selective). */
const SLOW_NS = 100_000_000; // 100 ms

const SEVERITY_ORDER: Record<Severity, number> = { crit: 0, warn: 1, info: 2 };

/** Run all detectors and return findings ranked by severity then impact. */
export function detectInsights(units: UnitDto[]): Finding[] {
  const findings: Finding[] = [];
  detectExceptions(units, findings);
  detectStatementsInLoop(units, findings);
  detectLoopBody(units, findings);
  detectRepeatedMethods(units, findings);
  detectRecursion(units, findings);
  detectLargeSlowQueries(units, findings);
  detectLimits(units, findings);
  detectCriticalPath(units, findings);
  return findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.sort - a.sort,
  );
}

function fmtMs(ns: number): string {
  return ns >= 1_000_000 ? `${(ns / 1_000_000).toFixed(1)} ms` : ns > 0 ? "<1 ms" : "";
}

/** Exceptions thrown / fatal errors — grouped by message so a loop that throws
 * repeatedly is one finding with a count. */
function detectExceptions(units: UnitDto[], out: Finding[]): void {
  const groups = new Map<string, { kind: string; msg: string; count: number }>();
  for (const u of units) {
    for (const e of u.exceptions ?? []) {
      const key = `${e.kind} ${e.message}`;
      const g = groups.get(key);
      if (g) g.count += 1;
      else groups.set(key, { kind: e.kind, msg: e.message, count: 1 });
    }
  }
  for (const g of groups.values()) {
    const fatal = g.kind === "FATAL_ERROR";
    const firstLine = (g.msg.split(/[|\n]/)[0] || g.msg).trim().slice(0, 140);
    const times = g.count > 1 ? ` (×${g.count})` : "";
    out.push({
      severity: fatal ? "crit" : "warn",
      kind: "exception",
      title: `${fatal ? "Fatal error" : "Exception thrown"}${times}: ${firstLine}`,
      detail: g.msg.length > 240 ? `${g.msg.slice(0, 240)}…` : g.msg,
      fix: fatal ? undefined : "Catch or guard the failing operation, or fix the root cause.",
      sort: g.count + (fatal ? 1_000_000 : 0),
    });
  }
}

/** SOQL/DML issued repeatedly (grouped by fingerprint) → almost certainly inside
 * a loop. The headline detector. */
function detectStatementsInLoop(units: UnitDto[], out: Finding[]): void {
  const groups = new Map<
    string,
    { kind: string; fp: string; count: number; rows: number; ns: number }
  >();
  for (const u of units) {
    for (const s of u.statements) {
      const fp = soqlFingerprint(s.text);
      const key = `${s.kind} ${fp}`;
      const g = groups.get(key);
      if (g) {
        g.count += 1;
        g.rows += s.rows;
        g.ns += s.durNs ?? 0;
      } else {
        groups.set(key, { kind: s.kind, fp, count: 1, rows: s.rows, ns: s.durNs ?? 0 });
      }
    }
  }
  for (const g of groups.values()) {
    if (g.count < LOOP_STMT_MIN) continue;
    const KIND = g.kind === "dml" ? "DML" : "SOQL";
    const time = g.ns > 0 ? `, ${fmtMs(g.ns)} total` : "";
    out.push({
      severity: "crit",
      kind: "stmt-in-loop",
      title: `${KIND} run ${g.count}× — likely inside a loop`,
      detail: `${g.fp} (${g.rows} rows${time})`,
      fix:
        g.kind === "dml"
          ? "Collect records and do one bulk DML after the loop."
          : "Move the query out of the loop — query once with a Set of ids (bulkify).",
      sort: g.ns || g.count,
    });
  }
}

/** A method invoked very many times — a loop body worth bulkifying. */
function detectRepeatedMethods(units: UnitDto[], out: Finding[]): void {
  const byName = new Map<string, { self: number; count: number }>();
  for (const u of units) {
    for (const h of u.hotspots) {
      const m = byName.get(h.signature);
      if (m) {
        m.count += h.count;
        m.self += h.selfNs;
      } else {
        byName.set(h.signature, { count: h.count, self: h.selfNs });
      }
    }
  }
  for (const [sig, m] of byName) {
    if (m.count < LOOP_METHOD_MIN) continue;
    out.push({
      severity: "warn",
      kind: "method-loop",
      title: `${sig} called ${m.count}×`,
      detail: m.self > 0 ? `${fmtMs(m.self)} self time total` : "called repeatedly",
      fix: "If this runs per-record, move work out of the loop or bulkify it.",
      sort: m.self || m.count,
    });
  }
}

/** Loop-body detection (lightweight motif mining): a node whose children repeat
 * the same label consecutively is a loop body. Pinpoints *where* the loop is and
 * catches smaller loops the global repeated-method threshold misses. */
function detectLoopBody(units: UnitDto[], out: Finding[]): void {
  const reported = new Set<string>();
  const visit = (node: ExecNodeDto): void => {
    const ch = node.children;
    let i = 0;
    while (i < ch.length) {
      let j = i;
      while (j < ch.length && ch[j].label === ch[i].label) j++;
      const run = j - i;
      const key = `${node.label}>${ch[i].label}`;
      if (run >= LOOP_BODY_MIN && ch[i].label && !reported.has(key)) {
        reported.add(key);
        out.push({
          severity: "warn",
          kind: "loop-body",
          title: `${ch[i].label} runs ${run}× in a row under ${node.label}`,
          detail: "A node repeated consecutively under one parent — a loop body.",
          fix: "Move per-iteration work (queries, DML, heavy logic) out of the loop.",
          sort: run,
        });
      }
      i = j;
    }
    for (const c of ch) visit(c);
  };
  for (const u of units) for (const root of u.tree) visit(root);
}

/** A method/code-unit that appears as its own ancestor in the call tree = it
 * re-enters itself (recursion / recursive trigger). */
function detectRecursion(units: UnitDto[], out: Finding[]): void {
  const maxDepth = new Map<string, number>();
  const walk = (node: ExecNodeDto, onPath: Map<string, number>): void => {
    const label = node.label.trim();
    const depth = (onPath.get(label) ?? 0) + 1;
    onPath.set(label, depth);
    if (label && depth >= 2) {
      maxDepth.set(label, Math.max(maxDepth.get(label) ?? 0, depth));
    }
    for (const child of node.children) walk(child, onPath);
    onPath.set(label, depth - 1);
  };
  for (const u of units) for (const root of u.tree) walk(root, new Map());

  for (const [label, depth] of maxDepth) {
    out.push({
      severity: depth >= 4 ? "crit" : "warn",
      kind: "recursion",
      title: `${label} re-enters itself (depth ${depth})`,
      detail: "Same unit appears in its own call stack — recursion or a recursive trigger.",
      fix: "Guard re-entry with a static flag or a processed-id Set.",
      sort: depth,
    });
  }
}

/** Governor limits at/over a healthy threshold (>=60% warn, >=90% crit). */
function detectLimits(units: UnitDto[], out: Finding[]): void {
  for (const u of units) {
    for (const r of u.limits) {
      for (const e of r.entries) {
        const sev = limitSeverity(e.used, e.max);
        if (sev === "ok" || e.max <= 0) continue;
        const pct = Math.round((e.used / e.max) * 100);
        const ns = r.namespace ? `${r.namespace}: ` : "";
        out.push({
          severity: sev === "crit" ? "crit" : "warn",
          kind: "limit",
          title: `${ns}${e.name} at ${pct}% of limit`,
          detail: `${e.used} of ${e.max} used`,
          fix: pct >= 100 ? "Limit exceeded — reduce usage in this transaction." : undefined,
          sort: pct,
        });
      }
    }
  }
}

/** A single query that returns a lot of rows or is slow (likely non-selective).
 * Skips queries already flagged as in-a-loop (that's the bigger finding). */
function detectLargeSlowQueries(units: UnitDto[], out: Finding[]): void {
  const agg = new Map<string, { fp: string; rows: number; ns: number; count: number }>();
  for (const u of units) {
    for (const s of u.statements) {
      if (s.kind !== "soql") continue;
      const fp = soqlFingerprint(s.text);
      const ns = s.durNs ?? 0;
      const a = agg.get(fp);
      if (a) {
        a.rows = Math.max(a.rows, s.rows);
        a.ns = Math.max(a.ns, ns);
        a.count += 1;
      } else {
        agg.set(fp, { fp, rows: s.rows, ns, count: 1 });
      }
    }
  }
  for (const a of agg.values()) {
    if (a.count >= LOOP_STMT_MIN) continue; // already reported as in-a-loop
    const big = a.rows >= ROWS_BIG;
    const slow = a.ns >= SLOW_NS;
    if (!big && !slow) continue;
    const title =
      big && slow
        ? `Slow, large query (${a.rows} rows, ${fmtMs(a.ns)})`
        : big
          ? `Large query (${a.rows} rows)`
          : `Slow query (${fmtMs(a.ns)})`;
    out.push({
      severity: "warn",
      kind: "slow-query",
      title,
      detail: a.fp,
      fix: "Add a selective, indexed filter (or LIMIT); avoid returning more rows than needed.",
      sort: a.ns || a.rows,
    });
  }
}

/** The chain of frames that dominates total time (Critical Path Tracing): from
 * the busiest root, always descend into the longest child. Tells the user where
 * to optimize for wall-clock — more useful than scattered self-times. */
function detectCriticalPath(units: UnitDto[], out: Finding[]): void {
  const dur = (n: ExecNodeDto) => n.durNs ?? 0;
  for (const u of units) {
    if (u.tree.length === 0) continue;
    const root = u.tree.reduce((a, b) => (dur(b) > dur(a) ? b : a));
    const total = dur(root);
    if (total <= 0) continue;
    const path: ExecNodeDto[] = [root];
    let cur = root;
    while (cur.children.length) {
      const next = cur.children.reduce((a, b) => (dur(b) > dur(a) ? b : a));
      if (dur(next) <= 0) break;
      path.push(next);
      cur = next;
    }
    if (path.length < 2) continue;
    const leaf = path[path.length - 1];
    const pct = Math.round((dur(leaf) / total) * 100);
    if (pct < 30) continue; // not a clear single hot path
    const bottleneck = path.reduce((a, b) => ((b.selfNs ?? 0) > (a.selfNs ?? 0) ? b : a));
    out.push({
      severity: "info",
      kind: "critical-path",
      title: `Critical path: ${pct}% of time ends in ${leaf.label}`,
      detail: path.map((n) => n.label).join(" → "),
      fix:
        (bottleneck.selfNs ?? 0) > 0
          ? `Most self-time: ${bottleneck.label} (${fmtMs(bottleneck.selfNs ?? 0)}). Optimize here.`
          : undefined,
      sort: total,
    });
  }
}
