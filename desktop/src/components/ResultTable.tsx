import { useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Rows3, Rows4 } from "lucide-react";
import type { SoqlResultDto } from "../types";

type Row = Record<string, string>;

const NUMERIC = /^-?\d+(\.\d+)?$/;
const ID_COL = /(^id$|id$)/i;

/** A column is right-aligned (tabular) if it reads like an id or holds numbers. */
function isNumericColumn(col: string, rows: Row[]): boolean {
  if (ID_COL.test(col)) return true;
  let seen = 0;
  for (const r of rows) {
    const v = r[col];
    if (v === "" || v == null) continue;
    seen++;
    if (!NUMERIC.test(v)) return false;
    if (seen >= 25) break;
  }
  return seen > 0;
}

export function ResultTable({
  data,
}: {
  data: Pick<SoqlResultDto, "columns" | "rows" | "total_size">;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [compact, setCompact] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const rowHeight = compact ? 24 : 32;

  const rows = useMemo<Row[]>(
    () =>
      data.rows.map((cells) => {
        const o: Row = {};
        data.columns.forEach((c, i) => (o[c] = cells[i] ?? ""));
        return o;
      }),
    [data]
  );

  const numericCols = useMemo(() => {
    const set = new Set<string>();
    for (const c of data.columns) if (isNumericColumn(c, rows)) set.add(c);
    return set;
  }, [data.columns, rows]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      data.columns.map((col, idx) => ({
        id: col,
        accessorFn: (r) => r[col],
        header: col,
        enableSorting: true,
        meta: { first: idx === 0, numeric: numericCols.has(col) },
      })),
    [data.columns, numericCols]
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const virtualize = tableRows.length > 100;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: virtualize,
  });

  function copyCell(text: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    window.setTimeout(() => setCopied(null), 1200);
  }

  function meta(colId: string) {
    return table.getColumn(colId)?.columnDef.meta as
      | { first?: boolean; numeric?: boolean }
      | undefined;
  }

  const virtualItems = virtualizer.getVirtualItems();
  const padTop = virtualize && virtualItems.length ? virtualItems[0].start : 0;
  const padBottom =
    virtualize && virtualItems.length
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="micro-label flex-1">RESULT</div>
        <button
          type="button"
          onClick={() => setCompact((c) => !c)}
          title={compact ? "Comfortable rows" : "Compact rows"}
          className="focus-accent inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-text-dim hover:text-text hover:bg-surface-3 cursor-pointer"
        >
          {compact ? <Rows3 size={14} /> : <Rows4 size={14} />}
        </button>
        <span className="tnum text-[11px] text-text-dim">
          {data.total_size} {data.total_size === 1 ? "row" : "rows"}
        </span>
      </div>

      {data.rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-text-faint text-[13px]">
          — no rows —
        </div>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const m = meta(header.column.id);
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                        }
                        onClick={header.column.getToggleSortingHandler()}
                        className={`select-none border-b border-line px-3 py-1.5 font-bold text-text-dim cursor-pointer hover:text-text ${
                          m?.numeric ? "text-right" : "text-left"
                        } ${m?.first ? "sticky left-0 z-20 bg-surface" : ""}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {sorted === "asc" && <ArrowUp size={12} />}
                          {sorted === "desc" && <ArrowDown size={12} />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {padTop > 0 && (
                <tr>
                  <td style={{ height: padTop }} />
                </tr>
              )}
              {(virtualize
                ? virtualItems.map((vi) => tableRows[vi.index])
                : tableRows
              ).map((row, i) => (
                <tr
                  key={row.id}
                  style={{ height: rowHeight }}
                  className={i % 2 === 1 ? "bg-surface/40" : ""}
                >
                  {row.getVisibleCells().map((cell) => {
                    const m = meta(cell.column.id);
                    const text = cell.getValue<string>() ?? "";
                    return (
                      <td
                        key={cell.id}
                        onClick={() => copyCell(text)}
                        title="Click to copy"
                        className={`border-b border-hair px-3 cursor-pointer hover:bg-surface-3 ${
                          m?.numeric ? "text-right tnum" : "text-left"
                        } ${m?.first ? "font-bold sticky left-0 bg-bg" : "text-text"} ${
                          copied !== null && copied === text
                            ? "text-accent"
                            : ""
                        }`}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {padBottom > 0 && (
                <tr>
                  <td style={{ height: padBottom }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
