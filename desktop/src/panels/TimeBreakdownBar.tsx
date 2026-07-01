import type { UnitDto } from "../types";
import { timeBreakdown, type TimeCategory } from "./timeBreakdown";

const CAT_COLOR: Record<TimeCategory, string> = {
  apex: "bg-slate-500",
  soql: "bg-success",
  dml: "bg-emerald-600",
  callout: "bg-amber-500",
  other: "bg-border",
};

const CAT_LABEL: Record<TimeCategory, string> = {
  apex: "Apex", soql: "SOQL", dml: "DML", callout: "Callout", other: "Other",
};

function ms(ns: number): string {
  return `${(ns / 1_000_000).toFixed(ns < 1_000_000 ? 3 : 2)} ms`;
}

/** One-row stacked bar showing where execution time went, with a legend. */
export function TimeBreakdownBar({ units }: { units: UnitDto[] }) {
  const slices = timeBreakdown(units);
  if (slices.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 pb-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-border">
        {slices.map((s) => (
          <span
            key={s.category}
            className={`h-full ${CAT_COLOR[s.category]}`}
            style={{ width: `${s.pct}%` }}
            title={`${CAT_LABEL[s.category]} · ${ms(s.ns)} · ${s.pct.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
        {slices.map((s) => (
          <span key={s.category} className="inline-flex items-center gap-1">
            <span className={`inline-block size-2 rounded-sm ${CAT_COLOR[s.category]}`} />
            {CAT_LABEL[s.category]} <span className="tnum text-foreground">{ms(s.ns)}</span>
            <span className="tnum">{s.pct.toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
