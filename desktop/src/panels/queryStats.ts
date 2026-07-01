/** SOQL/DML aggregation for the Queries hotspot view. Pure, unit-testable. */

export interface StmtLike {
  kind: string;
  text: string;
  rows: number;
  dur_ns: number | null;
}

export interface QueryGroup {
  kind: string;
  text: string;
  /** Times this identical statement ran (>1 is the N+1 signal). */
  count: number;
  /** Total rows across all runs. */
  rows: number;
  /** Total time across all runs, ns (null durations count as 0). */
  totalNs: number;
}

/** Group identical statements and rank by total DB time (the real hotspot),
 * breaking ties by run count. */
export function groupStatements(stmts: StmtLike[]): QueryGroup[] {
  const groups = new Map<string, QueryGroup>();
  for (const s of stmts) {
    const key = `${s.kind} ${s.text}`;
    const ns = s.dur_ns ?? 0;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.rows += s.rows;
      g.totalNs += ns;
    } else {
      groups.set(key, { kind: s.kind, text: s.text, count: 1, rows: s.rows, totalNs: ns });
    }
  }
  return [...groups.values()].sort((a, b) => b.totalNs - a.totalNs || b.count - a.count);
}

/** Sum of statement durations in ns (null counts as 0). */
export function totalNs(stmts: StmtLike[]): number {
  return stmts.reduce((n, s) => n + (s.dur_ns ?? 0), 0);
}

/** Normalize a SOQL/DML statement so runs differing only by bound values group
 * together — the N+1 / SOQL-in-loop signal. Strips string literals, collapses
 * IN (...) lists, replaces bare numbers, normalizes whitespace and case. */
export function soqlFingerprint(text: string): string {
  return text
    .replace(/'(?:[^'\\]|\\.)*'/g, "?")
    .replace(/\bIN\s*\([^)]*\)/gi, "IN (?)")
    .replace(/\b\d+\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export interface QueryFamily {
  fingerprint: string;
  kind: string;
  /** One representative original statement text. */
  sample: string;
  count: number;
  rows: number;
  totalNs: number;
}

/** Group statements by fingerprint, ranked by total DB time then run count. */
export function groupByFingerprint(stmts: StmtLike[]): QueryFamily[] {
  const fams = new Map<string, QueryFamily>();
  for (const s of stmts) {
    const fp = `${s.kind} ${soqlFingerprint(s.text)}`;
    const ns = s.dur_ns ?? 0;
    const f = fams.get(fp);
    if (f) {
      f.count += 1;
      f.rows += s.rows;
      f.totalNs += ns;
    } else {
      fams.set(fp, { fingerprint: fp, kind: s.kind, sample: s.text, count: 1, rows: s.rows, totalNs: ns });
    }
  }
  return [...fams.values()].sort((a, b) => b.totalNs - a.totalNs || b.count - a.count);
}
