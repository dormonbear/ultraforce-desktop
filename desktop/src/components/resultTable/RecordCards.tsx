import { displayValue } from "./childData";
import type { ChildTableDto, Scalar } from "../../types";

/**
 * One relationship inside the detail panel: section header (name + total +
 * truncation hint) followed by one key-value card per child record. Recursive:
 * a child record's own subqueries render as nested sections inside its card
 * (SOQL caps nesting at 5 levels).
 */
export function RelationshipSection({ table }: { table: ChildTableDto }) {
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
      <div className="flex flex-col gap-2">
        {table.rows.map((row, i) => (
          <RecordCard key={i} table={table} row={row} ordinal={i} />
        ))}
      </div>
    </div>
  );
}

/** One child record as a field-name / value card, plus its nested sections. */
function RecordCard({
  table,
  row,
  ordinal,
}: {
  table: ChildTableDto;
  row: Scalar[];
  ordinal: number;
}) {
  const nested = table.children.filter((c) => c.rowIndex === ordinal);
  // Relationships shown as nested sections skip their scalar count field.
  const nestedRels = new Set(nested.map((c) => c.column));
  const idIdx = table.columns.indexOf("Id");
  const id = idIdx >= 0 ? displayValue(row[idIdx] ?? null) : "";
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-baseline gap-2 border-b border-border bg-secondary px-2 py-1 text-[11px]">
        <span className="font-semibold text-muted-foreground">#{ordinal + 1}</span>
        {id && <span className="tabular-nums text-muted-foreground">{id}</span>}
      </div>
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <tbody>
          {table.columns.map((c, ci) => {
            if (nestedRels.has(c)) return null;
            const text = displayValue(row[ci] ?? null);
            return (
              <tr key={c}>
                <td
                  title={c}
                  className="w-36 max-w-36 truncate border-b border-border px-2 py-1 text-muted-foreground"
                >
                  {c}
                </td>
                <td
                  title={text || undefined}
                  className="border-b border-border px-2 py-1 text-foreground"
                >
                  {text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {nested.length > 0 && (
        <div className="flex flex-col gap-2 py-2 pl-4 pr-2">
          {nested.map((t) => (
            <RelationshipSection key={t.column} table={t} />
          ))}
        </div>
      )}
    </div>
  );
}
