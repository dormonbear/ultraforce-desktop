/**
 * Differential analysis between two parsed logs (a baseline "A" and a candidate
 * "B") — the regression-localization idea borrowed from distributed-tracing
 * tools ("compare a fast trace with a slow one"). Pure, unit-testable.
 */
import type { UnitDto } from "../types";
import { soqlFingerprint } from "./soqlFingerprint";

export interface QueryDiff {
  fp: string;
  kind: string;
  countA: number;
  countB: number;
  nsA: number;
  nsB: number;
}

export interface LimitDiff {
  name: string;
  usedA: number;
  usedB: number;
  max: number;
}

export interface LogDiff {
  /** Query families whose run count or time changed, biggest change first. */
  queries: QueryDiff[];
  /** Limits whose usage changed, biggest change first. */
  limits: LimitDiff[];
  totals: {
    soqlA: number;
    soqlB: number;
    dmlA: number;
    dmlB: number;
    exceptionsA: number;
    exceptionsB: number;
  };
}

interface Agg {
  kind: string;
  count: number;
  ns: number;
}

function aggregateQueries(units: UnitDto[]): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const u of units) {
    for (const s of u.statements) {
      const key = `${s.kind} ${soqlFingerprint(s.text)}`;
      const a = m.get(key);
      const ns = s.dur_ns ?? 0;
      if (a) {
        a.count += 1;
        a.ns += ns;
      } else {
        m.set(key, { kind: s.kind, count: 1, ns });
      }
    }
  }
  return m;
}

function aggregateLimits(units: UnitDto[]): Map<string, { used: number; max: number }> {
  const m = new Map<string, { used: number; max: number }>();
  for (const u of units) {
    for (const r of u.limits) {
      for (const e of r.entries) {
        const key = r.namespace ? `${r.namespace}: ${e.name}` : e.name;
        // Keep the highest observed usage for the key.
        const cur = m.get(key);
        if (!cur || e.used > cur.used) m.set(key, { used: e.used, max: e.max });
      }
    }
  }
  return m;
}

const count = (units: UnitDto[], kind: "soql" | "dml") =>
  units.reduce((n, u) => n + u.statements.filter((s) => s.kind === kind).length, 0);
const exCount = (units: UnitDto[]) => units.reduce((n, u) => n + u.exceptions.length, 0);

/** Compare baseline `a` against candidate `b`. */
export function diffLogs(a: UnitDto[], b: UnitDto[]): LogDiff {
  const qa = aggregateQueries(a);
  const qb = aggregateQueries(b);
  const queries: QueryDiff[] = [];
  for (const key of new Set([...qa.keys(), ...qb.keys()])) {
    const av = qa.get(key);
    const bv = qb.get(key);
    const fp = key.slice(key.indexOf(" ") + 1);
    const kind = (av ?? bv)!.kind;
    const countA = av?.count ?? 0;
    const countB = bv?.count ?? 0;
    const nsA = av?.ns ?? 0;
    const nsB = bv?.ns ?? 0;
    if (countA !== countB || nsA !== nsB) {
      queries.push({ fp, kind, countA, countB, nsA, nsB });
    }
  }
  queries.sort(
    (x, y) =>
      Math.abs(y.countB - y.countA) - Math.abs(x.countB - x.countA) ||
      Math.abs(y.nsB - y.nsA) - Math.abs(x.nsB - x.nsA),
  );

  const la = aggregateLimits(a);
  const lb = aggregateLimits(b);
  const limits: LimitDiff[] = [];
  for (const key of new Set([...la.keys(), ...lb.keys()])) {
    const av = la.get(key);
    const bv = lb.get(key);
    const usedA = av?.used ?? 0;
    const usedB = bv?.used ?? 0;
    if (usedA !== usedB) {
      limits.push({ name: key, usedA, usedB, max: bv?.max ?? av?.max ?? 0 });
    }
  }
  limits.sort((x, y) => Math.abs(y.usedB - y.usedA) - Math.abs(x.usedB - x.usedA));

  return {
    queries,
    limits,
    totals: {
      soqlA: count(a, "soql"),
      soqlB: count(b, "soql"),
      dmlA: count(a, "dml"),
      dmlB: count(b, "dml"),
      exceptionsA: exCount(a),
      exceptionsB: exCount(b),
    },
  };
}
