import {
  usagePct,
  limitSeverity,
  rankByUsage,
  type LimitSeverity,
} from "../limitStats";
import type { UnitDto } from "../../types";

const SEVERITY_BAR: Record<LimitSeverity, string> = {
  ok: "bg-text-dim",
  warn: "bg-amber-500",
  crit: "bg-destructive",
};
const SEVERITY_TEXT: Record<LimitSeverity, string> = {
  ok: "text-text-dim",
  warn: "text-amber-500",
  crit: "text-destructive",
};

/** Governor-limit dashboard: per namespace, each limit as a usage bar ranked
 * tightest-first, so the limit closest to breaching is obvious at a glance. */
export function LimitsView({ units }: { units: UnitDto[] }) {
  const rollups = units.flatMap((u) => u.limits);
  if (rollups.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No limit usage
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {rollups.map((rollup, ri) => (
        <div key={ri}>
          <div className="micro-label pb-1.5">
            {rollup.namespace || "(default)"}
          </div>
          <div className="flex flex-col gap-1.5">
            {rankByUsage(rollup.entries).map((e, ei) => {
              const sev = limitSeverity(e.used, e.max);
              const pct = usagePct(e.used, e.max);
              return (
                <div key={ei} className="text-[12px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-foreground">{e.name}</span>
                    <span className={`tnum shrink-0 font-mono ${SEVERITY_TEXT[sev]}`}>
                      {e.used}/{e.max}
                      {e.max > 0 ? ` · ${pct}%` : ""}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-border">
                    <span
                      className={`block h-full rounded-full ${SEVERITY_BAR[sev]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
