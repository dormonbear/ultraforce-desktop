import { detectInsights, type Severity } from "../insights";
import type { UnitDto } from "../../types";
import type { DetailTab } from "./types";

const INSIGHT_DOT: Record<Severity, string> = {
  crit: "bg-destructive",
  warn: "bg-amber-500",
  info: "bg-primary",
};

/** Which tab a finding's evidence lives in, so the user can jump straight to it. */
const FINDING_TAB: Record<string, DetailTab> = {
  exception: "raw",
  "stmt-in-loop": "queries",
  "slow-query": "queries",
  limit: "limits",
  recursion: "timeline",
  "loop-body": "timeline",
  "method-loop": "timeline",
  "critical-path": "timeline",
};

/** Insights: rule-based diagnostics (exceptions, SOQL/DML-in-loop, loop bodies,
 * repeated methods, recursion, large/slow queries, governor limits, critical
 * path) with a one-line fix and a jump to the evidence — the analyser layer on
 * top of the raw/timeline viewers. */
export function InsightsView({
  units,
  onGoto,
}: {
  units: UnitDto[];
  onGoto: (tab: DetailTab) => void;
}) {
  const findings = detectInsights(units);
  if (findings.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No issues detected
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {findings.map((f, i) => {
        const goto = FINDING_TAB[f.kind];
        return (
          <div key={i} className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <div className="flex items-baseline gap-2">
              <span
                className={`mt-1 size-1.5 shrink-0 rounded-full ${INSIGHT_DOT[f.severity]}`}
              />
              <span className="text-[12px] font-medium text-foreground">{f.title}</span>
              {goto && (
                <button
                  type="button"
                  onClick={() => onGoto(goto)}
                  className="ml-auto shrink-0 cursor-pointer text-[11px] text-text-dim hover:text-primary"
                >
                  View {goto} →
                </button>
              )}
            </div>
            <div className="mt-0.5 break-words pl-3.5 text-[11px] text-text-dim">
              {f.detail}
            </div>
            {f.fix && (
              <div className="mt-1 pl-3.5 text-[11px] text-muted-foreground">
                <span className="text-text-dim">Fix: </span>
                {f.fix}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
