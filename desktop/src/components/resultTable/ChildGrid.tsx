import { displayValue } from "./childData";
import type { ChildTableDto } from "../../types";

/**
 * One stacked, labeled subgrid inside an expanded parent row. Child pages are
 * ≤200 rows (SF default; child queryMore is out of scope) — no virtualization.
 */
export function ChildGrid({ table }: { table: ChildTableDto }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[12px] font-semibold text-foreground">
          {table.column} ({table.totalSize.toLocaleString()})
        </span>
        {!table.done && (
          <span className="text-[11px] text-muted-foreground">
            {table.rows.length.toLocaleString()} of {table.totalSize.toLocaleString()} loaded
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-border bg-secondary px-2 py-1 text-left font-semibold text-muted-foreground"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? "bg-muted/50" : undefined}>
                {table.columns.map((c, ci) => {
                  const text = displayValue(row[ci] ?? null);
                  return (
                    <td
                      key={c}
                      title={text || undefined}
                      className="max-w-64 truncate border-b border-border px-2 py-1 text-foreground"
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
