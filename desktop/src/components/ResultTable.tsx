import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Copy,
  Download,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { copyText } from "../clipboard";
import {
  EXPORT_FORMATS,
  toJson,
  toMarkdown,
  writeExportFile,
  type ExportFormatDef,
} from "./export";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SoqlResultDto } from "../types";

type Row = Record<string, string>;

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Right-align a column only when its values are genuine numbers (Ids stay left). */
function isNumericColumn(col: string, rows: Row[]): boolean {
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

type ColMeta = { numeric?: boolean };

const GUTTER_W = 52;

export function ResultTable({
  data,
}: {
  data: Pick<SoqlResultDto, "columns" | "rows" | "totalSize">;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [copied, setCopied] = useState<string | null>(null);

  const rowHeight = 34;

  const exportAs = async (fmt: ExportFormatDef) => {
    try {
      const path = await save({
        defaultPath: `query-result.${fmt.ext}`,
        filters: [{ name: fmt.label, extensions: [fmt.ext] }],
      });
      if (!path) return;
      await writeExportFile(path, fmt, data.columns, data.rows);
      toast.success(`Exported ${data.rows.length} rows to ${fmt.label}`);
    } catch (e) {
      toast.error(`Export failed: ${typeof e === "string" ? e : String(e)}`);
    }
  };

  const copyAs = (kind: "tsv" | "md" | "json") => {
    const n = data.rows.length;
    const suffix = `${n} row${n === 1 ? "" : "s"}`;
    if (kind === "md") {
      void copyText(toMarkdown(data.columns, data.rows), `Copied ${suffix} as Markdown`);
    } else if (kind === "json") {
      void copyText(toJson(data.columns, data.rows), `Copied ${suffix} as JSON`);
    } else {
      const tsv = [
        data.columns.join("\t"),
        ...data.rows.map((r) =>
          r.map((c) => (c == null ? "" : String(c))).join("\t"),
        ),
      ].join("\n");
      void copyText(tsv, `Copied ${suffix}`);
    }
  };

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
      data.columns.map((col) => ({
        id: col,
        accessorFn: (r) => r[col],
        header: col,
        enableSorting: true,
        enableHiding: true,
        meta: { numeric: numericCols.has(col) } satisfies ColMeta,
      })),
    [data.columns, numericCols]
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    defaultColumn: { minSize: 80, size: 200 },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const parentRef = useRef<HTMLDivElement>(null);
  // Floating horizontal scrollbar pinned to the container's visible bottom,
  // kept in sync with the table's own horizontal scroll (which has its native
  // x-scrollbar hidden) so it stays put while scrolling rows vertically.
  const barRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const hasRows = data.rows.length > 0;

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, [hasRows]);

  const syncBarFromBody = () => {
    const b = barRef.current;
    const p = parentRef.current;
    if (b && p && b.scrollLeft !== p.scrollLeft) b.scrollLeft = p.scrollLeft;
  };
  const syncBodyFromBar = () => {
    const b = barRef.current;
    const p = parentRef.current;
    if (b && p && p.scrollLeft !== b.scrollLeft) p.scrollLeft = b.scrollLeft;
  };
  // The body has overflow-x hidden, so forward trackpad/shift horizontal wheel
  // into programmatic scroll (scrollLeft still works under overflow:hidden).
  const onBodyWheel = (e: React.WheelEvent) => {
    if (e.deltaX === 0) return;
    const p = parentRef.current;
    if (p) p.scrollLeft += e.deltaX;
  };

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

  const numeric = (c: Column<Row>) =>
    (c.columnDef.meta as ColMeta | undefined)?.numeric ?? false;

  const virtualItems = virtualizer.getVirtualItems();
  const visibleLeafCount = table.getVisibleLeafColumns().length;
  const padTop = virtualize && virtualItems.length ? virtualItems[0].start : 0;
  const padBottom =
    virtualize && virtualItems.length
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;
  const renderRows = virtualize
    ? virtualItems.map((vi) => ({ row: tableRows[vi.index], index: vi.index }))
    : tableRows.map((row, index) => ({ row, index }));

  const tableWidth = GUTTER_W + table.getCenterTotalSize();
  const hasXOverflow = containerW > 0 && tableWidth > containerW + 1;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Filter rows…"
            className="h-7 w-56 pl-8 text-[12px]"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="focus-accent inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-[12px] text-muted-foreground hover:text-foreground cursor-pointer">
            <SlidersHorizontal size={13} /> Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            {table.getAllLeafColumns().map((col) => (
              <DropdownMenuCheckboxItem
                key={col.id}
                checked={col.getIsVisible()}
                onCheckedChange={(v) => col.toggleVisibility(!!v)}
                onSelect={(e) => e.preventDefault()}
              >
                {col.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              aria-label="Copy result"
              title="Copy all rows (tab-separated — right-click for Markdown / JSON)"
              onClick={() => copyAs("tsv")}
              className="focus-accent inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <Copy size={14} />
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => copyAs("md")}>
              Copy as Markdown
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copyAs("json")}>
              Copy as JSON
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Export"
              className="focus-accent inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <Download size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Export as</DropdownMenuLabel>
            {EXPORT_FORMATS.map((fmt) => (
              <DropdownMenuItem
                key={fmt.id}
                onSelect={() => void exportAs(fmt)}
              >
                {fmt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Only shown when the visible set differs from the full result (filtered
            or partially loaded); the full count lives in the panel status line. */}
        {tableRows.length !== data.totalSize && (
          <span className="tnum text-[11px] text-muted-foreground">
            {tableRows.length.toLocaleString()} / {data.totalSize.toLocaleString()} shown
          </span>
        )}
      </div>

      {data.rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          No rows
        </div>
      ) : (
        <div
          ref={parentRef}
          onScroll={syncBarFromBody}
          onWheel={onBodyWheel}
          className="uf-scroll select-text min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-border"
        >
          <Table
            style={{ width: tableWidth }}
            className="border-separate border-spacing-0 text-[13px]"
          >
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {/* row-number gutter */}
                  <TableHead
                    style={{ width: GUTTER_W }}
                    className="sticky left-0 top-0 z-30 h-8 border-b border-border bg-secondary px-0 text-center align-middle text-[10px] font-semibold text-muted-foreground"
                  >
                    #
                  </TableHead>
                  {hg.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        style={{ width: header.getSize() }}
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                        }
                        className={cn(
                          "group relative sticky top-0 z-20 h-8 select-none border-b border-border bg-secondary px-3 align-middle font-semibold text-muted-foreground",
                          numeric(header.column) ? "text-right" : "text-left"
                        )}
                      >
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex max-w-full items-center gap-1 truncate hover:text-foreground cursor-pointer",
                            numeric(header.column) && "flex-row-reverse"
                          )}
                        >
                          <span className="truncate">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                          </span>
                          {sorted === "asc" ? (
                            <ArrowUp size={12} className="shrink-0 text-primary" />
                          ) : sorted === "desc" ? (
                            <ArrowDown size={12} className="shrink-0 text-primary" />
                          ) : (
                            <ChevronsUpDown
                              size={12}
                              className="shrink-0 opacity-0 group-hover:opacity-40"
                            />
                          )}
                        </button>
                        {/* copy this column's values (respects filter/sort) */}
                        <button
                          type="button"
                          aria-label={`Copy ${header.column.id} column`}
                          title={`Copy all ${header.column.id} values`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const col = header.column.id;
                            const vals = table
                              .getRowModel()
                              .rows.map((r) => String(r.getValue(col) ?? ""));
                            void copyText(
                              vals.join("\n"),
                              `Copied ${vals.length} ${col} value${vals.length === 1 ? "" : "s"}`,
                            );
                          }}
                          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          <Copy size={11} />
                        </button>
                        {/* resize handle */}
                        <span
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            "absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none bg-transparent hover:bg-primary/40",
                            header.column.getIsResizing() && "bg-primary"
                          )}
                        />
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {padTop > 0 && (
                <tr>
                  <td colSpan={visibleLeafCount + 1} style={{ height: padTop }} />
                </tr>
              )}
              {renderRows.map(({ row, index }) => (
                <TableRow
                  key={row.id}
                  style={{ height: rowHeight }}
                  className={cn(
                    "group/row border-0 hover:bg-accent/60",
                    index % 2 === 1 && "bg-muted/50"
                  )}
                >
                  <TableCell
                    style={{ width: GUTTER_W }}
                    className="sticky left-0 z-10 border-b border-border bg-inherit px-0 text-center align-middle text-[10px] tabular-nums text-muted-foreground group-hover/row:bg-accent/60"
                  >
                    {index + 1}
                  </TableCell>
                  {row.getVisibleCells().map((cell) => {
                    const text = cell.getValue<string>() ?? "";
                    const isCopied = copied !== null && copied === text;
                    return (
                      <TableCell
                        key={cell.id}
                        // Show the full value on hover (cells truncate); the cell
                        // is still click-to-copy.
                        title={text || undefined}
                        onClick={() => copyCell(text)}
                        style={{ width: cell.column.getSize() }}
                        className={cn(
                          "max-w-0 cursor-pointer truncate border-b border-border px-3 align-middle",
                          numeric(cell.column)
                            ? "text-right tabular-nums"
                            : "text-left",
                          isCopied ? "text-primary" : "text-foreground"
                        )}
                      >
                        {text}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {padBottom > 0 && (
                <tr>
                  <td
                    colSpan={visibleLeafCount + 1}
                    style={{ height: padBottom }}
                  />
                </tr>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {data.rows.length > 0 && hasXOverflow && (
        <div
          ref={barRef}
          onScroll={syncBodyFromBar}
          className="uf-scroll shrink-0 overflow-x-auto overflow-y-hidden border-t border-border"
          style={{ height: 14 }}
        >
          <div style={{ width: tableWidth, height: 1 }} />
        </div>
      )}
    </div>
  );
}
