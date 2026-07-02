import { groupByFingerprint, totalNs } from "../queryStats";
import { formatMs } from "./format";
import type { StatementDto, UnitDto } from "../../types";

/** SOQL/DML statements: a per-unit summary + queries grouped by text, ranked by
 * total DB time (hotspot first). Count > 1 is the N+1 signal. */
// fallow-ignore-next-line complexity
export function QueriesView({ units }: { units: UnitDto[] }) {
  const all = units.flatMap((u) => u.statements);
  if (all.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No SOQL or DML
      </div>
    );
  }
  const soql = all.filter((s) => s.kind === "soql");
  const dml = all.filter((s) => s.kind === "dml");
  const sumRows = (xs: StatementDto[]) => xs.reduce((n, s) => n + s.rows, 0);

  const families = groupByFingerprint(all);
  const maxNs = families.length > 0 ? families[0].totalNs : 0;
  const soqlNs = totalNs(soql);
  const dmlNs = totalNs(dml);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] text-text-dim">
        <span className="text-foreground">{soql.length}</span> SOQL ({sumRows(soql)} rows
        {soqlNs > 0 ? `, ${formatMs(soqlNs)}` : ""})
        {" · "}
        <span className="text-foreground">{dml.length}</span> DML ({sumRows(dml)} rows
        {dmlNs > 0 ? `, ${formatMs(dmlNs)}` : ""})
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-left font-normal">Statement</th>
            <th className="whitespace-nowrap px-1.5 py-1 text-right font-normal">Time</th>
            <th className="whitespace-nowrap px-1.5 py-1 text-right font-normal">×</th>
            <th className="whitespace-nowrap px-1.5 py-1 text-right font-normal">Rows</th>
          </tr>
        </thead>
        <tbody>
          {families.map(
            // fallow-ignore-next-line complexity
            (g, i) => (
            <tr
              key={i}
              className={`border-t border-border/50 ${g.count > 1 ? "text-destructive" : "text-text-dim"}`}
              title={g.count > 1 ? "run more than once — possible N+1 / loop" : g.sample}
            >
              <td className="relative w-full max-w-0 truncate py-0.5 pr-2 text-foreground" title={g.sample}>
                <span
                  className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-success/10"
                  style={{ width: `${maxNs > 0 ? (g.totalNs / maxNs) * 100 : 0}%` }}
                  aria-hidden
                />
                <span className="text-text-dim/70">{g.kind === "dml" ? "DML " : "SOQL "}</span>
                {g.sample}
              </td>
              <td className="tnum whitespace-nowrap px-1.5 py-0.5 text-right">{g.totalNs > 0 ? formatMs(g.totalNs) : "—"}</td>
              <td className="tnum whitespace-nowrap px-1.5 py-0.5 text-right">{g.count}</td>
              <td className="tnum whitespace-nowrap px-1.5 py-0.5 text-right">{g.rows}</td>
            </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
