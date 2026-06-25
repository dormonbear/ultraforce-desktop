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
