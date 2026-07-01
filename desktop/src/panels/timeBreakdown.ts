import type { UnitDto, ExecNodeDto } from "../types";

export type TimeCategory = "apex" | "soql" | "dml" | "callout" | "other";

export interface TimeSlice {
  category: TimeCategory;
  /** Summed self-time in ns. */
  ns: number;
  /** Share of total self-time, 0-100. */
  pct: number;
}

function categoryOf(kind: string): TimeCategory {
  if (/SOQL_EXECUTE|SOSL_EXECUTE/.test(kind)) return "soql";
  if (/DML_/.test(kind)) return "dml";
  if (/CALLOUT_/.test(kind)) return "callout";
  if (/METHOD_|CONSTRUCTOR_|CODE_UNIT_|EXECUTION_/.test(kind)) return "apex";
  return "other";
}

/** Split total self-time across categories (apex vs DB vs callout vs other),
 * sorted descending, zero slices dropped. Self-time avoids double counting
 * because a parent's children are excluded from its own self_ns. */
export function timeBreakdown(units: UnitDto[]): TimeSlice[] {
  const sums: Record<TimeCategory, number> = {
    apex: 0, soql: 0, dml: 0, callout: 0, other: 0,
  };
  const walk = (n: ExecNodeDto) => {
    sums[categoryOf(n.label)] += n.self_ns ?? 0;
    for (const c of n.children) walk(c);
  };
  for (const u of units) for (const n of u.tree) walk(n);

  const total = Object.values(sums).reduce((a, b) => a + b, 0);
  return (Object.keys(sums) as TimeCategory[])
    .map((category) => ({
      category,
      ns: sums[category],
      pct: total > 0 ? (sums[category] / total) * 100 : 0,
    }))
    .filter((s) => s.ns > 0)
    .sort((a, b) => b.ns - a.ns);
}
