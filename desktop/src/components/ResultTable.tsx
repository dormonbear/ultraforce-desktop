import { formatIpcError } from "../errorFormat";
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
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { copyText } from "../clipboard";
import {
  toJson,
  toMarkdown,
  writeExportFile,
  type ExportFormatDef,
} from "./export";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SoqlResultDto } from "../types";
import { buildChildLookup } from "./resultTable/childData";
import { flattenTable } from "./resultTable/flatten";
import { ChildGrid } from "./resultTable/ChildGrid";
import { Toolbar } from "./resultTable/Toolbar";
import { FilterBuilder } from "./resultTable/filter/FilterBuilder";
import { buildFilterFields } from "./resultTable/filter/fields";
import { evaluateGroup } from "./resultTable/filter/evaluate";
import type { RuleGroupType } from "react-querybuilder";

export interface GridRow {
  /** Original index into data.rows — stable across sort/filter. */
  idx: number;
  cells: Record<string, string>;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Right-align a column only when its values are genuine numbers (Ids stay left). */
function isNumericColumn(col: string, rows: GridRow[]): boolean {
  let seen = 0;
  for (const r of rows) {
    const v = r.cells[col];
    if (v === "" || v == null) continue;
    seen++;
    if (!NUMERIC.test(v)) return false;
    if (seen >= 25) break;
  }
  return seen > 0;
}

type ColMeta = { numeric?: boolean };

const GUTTER_W = 52;

/** Above this many visible leaf columns, window the columns horizontally. */
const COL_VIRTUALIZE_MIN = 40;

// fallow-ignore-next-line complexity
export function ResultTable({
  data,
  initialAdvancedFilter,
}: {
  data: Pick<SoqlResultDto, "columns" | "rows" | "totalSize" | "childTables">;
  initialAdvancedFilter?: RuleGroupType;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"expand" | "flatten">("expand");
  // Advanced filter rules; `activeIdx` below applies them to the visible rows.
  const [advancedFilter, setAdvancedFilter] = useState<RuleGroupType>(
    initialAdvancedFilter ?? { combinator: "and", rules: [] },
  );
  const [showFilter, setShowFilter] = useState(false);

  const toggleExpanded = (idx: number) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const lookup = useMemo(() => buildChildLookup(data.childTables), [data.childTables]);
  const filterFields = useMemo(
    () => buildFilterFields(data.columns, lookup),
    [data.columns, lookup],
  );

  const flat = useMemo(
    () => flattenTable(data.columns, data.rows, lookup),
    [data.columns, data.rows, lookup],
  );
  const activeColumns = viewMode === "flatten" ? flat.columns : data.columns;
  const activeRows = viewMode === "flatten" ? flat.rows : data.rows;

  // Original-index list surviving the advanced filter. Predicates evaluate
  // against ORIGINAL parent columns + typed child tables, so filtering is
  // view-independent (same result in Nested and Flat).
  const activeIdx = useMemo(() => {
    const all = data.rows.map((_, i) => i);
    if (advancedFilter.rules.length === 0) return all;
    return all.filter((i) =>
      evaluateGroup(advancedFilter, {
        parent: Object.fromEntries(
          data.columns.map((c, ci) => [c, data.rows[i][ci] ?? ""]),
        ),
        children: lookup.byRow.get(i) ?? new Map(),
      }),
    );
  }, [data, advancedFilter, lookup]);

  const rowHeight = 34;

  const exportAs = async (fmt: ExportFormatDef) => {
    try {
      const path = await save({
        defaultPath: `query-result.${fmt.ext}`,
        filters: [{ name: fmt.label, extensions: [fmt.ext] }],
      });
      if (!path) return;
      const t = exportTable();
      await writeExportFile(path, fmt, t.columns, t.rows);
      toast.success(`Exported ${t.rows.length} rows to ${fmt.label}`);
    } catch (e) {
      toast.error(`Export failed: ${formatIpcError(e)}`);
    }
  };

  const copyAs = (kind: "tsv" | "md" | "json") => {
    const t = exportTable();
    const n = t.rows.length;
    const suffix = `${n} row${n === 1 ? "" : "s"}`;
    if (kind === "md") {
      void copyText(toMarkdown(t.columns, t.rows), `Copied ${suffix} as Markdown`);
    } else if (kind === "json") {
      void copyText(toJson(t.columns, t.rows), `Copied ${suffix} as JSON`);
    } else {
      const tsv = [
        t.columns.join("\t"),
        ...t.rows.map((r) =>
          r.map((c) => (c == null ? "" : String(c))).join("\t"),
        ),
      ].join("\n");
      void copyText(tsv, `Copied ${suffix}`);
    }
  };

  const rows = useMemo<GridRow[]>(
    () =>
      activeIdx.map((idx) => {
        const o: Record<string, string> = {};
        activeColumns.forEach((c, i) => (o[c] = activeRows[idx][i] ?? ""));
        return { idx, cells: o };
      }),
    [activeIdx, activeColumns, activeRows]
  );

  const numericCols = useMemo(() => {
    const set = new Set<string>();
    for (const c of activeColumns) if (isNumericColumn(c, rows)) set.add(c);
    return set;
  }, [activeColumns, rows]);

  const columns = useMemo<ColumnDef<GridRow>[]>(
    () =>
      activeColumns.map((col) => ({
        id: col,
        accessorFn: (r) => r.cells[col],
        header: col,
        enableSorting: true,
        enableHiding: true,
        meta: { numeric: numericCols.has(col) } satisfies ColMeta,
      })),
    [activeColumns, numericCols]
  );

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => String(r.idx),
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

  /** Flattened projection of the currently visible rows (filter + sort applied). */
  const exportTable = (): { columns: string[]; rows: string[][] } => ({
    columns: flat.columns,
    rows: table.getRowModel().rows.map((r) => flat.rows[r.original.idx]),
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

  // Expansion introduces variable row heights, so we virtualize a display list
  // (one item per visible parent row + one per expanded detail row) rather than
  // the table rows directly — each item renders exactly one <tr> so
  // measureElement measures real heights.
  type DisplayItem =
    | { kind: "row"; row: (typeof tableRows)[number]; ordinal: number }
    | { kind: "detail"; row: (typeof tableRows)[number] };

  const displayItems = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = [];
    tableRows.forEach((row, ordinal) => {
      items.push({ kind: "row", row, ordinal });
      if (
        viewMode === "expand" &&
        expanded.has(row.original.idx) &&
        lookup.byRow.has(row.original.idx)
      )
        items.push({ kind: "detail", row });
    });
    return items;
  }, [tableRows, expanded, viewMode, lookup]);

  const virtualize = displayItems.length > 100;

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (displayItems[i].kind === "row" ? rowHeight : 240),
    overscan: 12,
    enabled: virtualize,
  });

  // Horizontal column windowing for very wide (flattened) results. The scroll
  // container is overflow-x:hidden but horizontal scrollLeft is still written
  // programmatically (floating bar + wheel forwarding), which fires `scroll`
  // events the virtualizer listens to — so it layers on top of the existing
  // sync machinery without touching it.
  const visibleColumns = table.getVisibleLeafColumns();
  const colVirtualize = visibleColumns.length > COL_VIRTUALIZE_MIN;
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: visibleColumns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => visibleColumns[i].getSize(),
    overscan: 6,
    enabled: colVirtualize,
  });
  // Column widths change on resize/visibility — remeasure.
  useEffect(() => {
    colVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getCenterTotalSize(), visibleColumns.length]);

  function copyCell(text: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    window.setTimeout(() => setCopied(null), 1200);
  }

  const numeric = (c: Column<GridRow>) =>
    (c.columnDef.meta as ColMeta | undefined)?.numeric ?? false;

  const virtualItems = virtualizer.getVirtualItems();
  const visibleLeafCount = table.getVisibleLeafColumns().length;
  const padTop = virtualize && virtualItems.length ? virtualItems[0].start : 0;
  const padBottom =
    virtualize && virtualItems.length
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;
  const renderItems = virtualize
    ? virtualItems.map((vi) => ({ item: displayItems[vi.index], index: vi.index }))
    : displayItems.map((item, index) => ({ item, index }));

  const virtualCols = colVirtualizer.getVirtualItems();
  // Only window once the virtualizer has actually measured a viewport and
  // produced items; before that (or when disabled) render every column, which
  // keeps below-threshold output identical and avoids a blank first paint.
  const windowCols = colVirtualize && virtualCols.length > 0;
  const colPadLeft = windowCols ? virtualCols[0].start : 0;
  const colPadRight = windowCols
    ? colVirtualizer.getTotalSize() - virtualCols[virtualCols.length - 1].end
    : 0;
  // Full-width spanning rows (detail panel + vertical spacers) must cover the
  // gutter, the windowed cells, and any left/right spacer cells.
  const detailColSpan = windowCols
    ? virtualCols.length + (colPadLeft > 0 ? 1 : 0) + (colPadRight > 0 ? 1 : 0) + 1
    : visibleLeafCount + 1;

  const tableWidth = GUTTER_W + table.getCenterTotalSize();
  const hasXOverflow = containerW > 0 && tableWidth > containerW + 1;

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        table={table}
        viewMode={viewMode}
        onViewModeChange={(m) => {
          setViewMode(m);
          setSorting([]);
          setColumnVisibility({});
          setExpanded(new Set());
        }}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        flat={flat}
        lookup={lookup}
        showFilter={showFilter}
        onToggleFilter={() => setShowFilter((v) => !v)}
        advancedFilter={advancedFilter}
        copyAs={copyAs}
        exportAs={exportAs}
        shownCount={tableRows.length}
        totalSize={data.totalSize}
      />

      {showFilter && (
        <FilterBuilder
          fields={filterFields}
          query={advancedFilter}
          onQueryChange={setAdvancedFilter}
        />
      )}

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
                  {colPadLeft > 0 && (
                    <TableHead
                      style={{ width: colPadLeft, padding: 0 }}
                      className="border-b border-border bg-secondary"
                    />
                  )}
                  {(windowCols
                    ? virtualCols.map((vc) => hg.headers[vc.index])
                    : hg.headers
                  ).map((header) => {
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
                  {colPadRight > 0 && (
                    <TableHead
                      style={{ width: colPadRight, padding: 0 }}
                      className="border-b border-border bg-secondary"
                    />
                  )}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {padTop > 0 && (
                <tr>
                  <td colSpan={detailColSpan} style={{ height: padTop }} />
                </tr>
              )}
              {renderItems.map(
                // fallow-ignore-next-line complexity
                ({ item, index }) => {
                const row = item.row;
                if (item.kind === "detail") {
                  return (
                    <TableRow
                      key={`${row.id}-detail`}
                      data-index={index}
                      ref={virtualize ? virtualizer.measureElement : undefined}
                      className="border-0 hover:bg-transparent"
                    >
                      <TableCell
                        colSpan={detailColSpan}
                        className="border-b border-border bg-muted/30 px-0"
                      >
                        {/* sticky left-0 + width:containerW keeps the subgrid in
                            view while the parent grid is horizontally scrolled. */}
                        <div
                          className="sticky left-0 flex max-w-full flex-col gap-3 px-14 py-3"
                          style={{ width: containerW || undefined }}
                        >
                          {[...(lookup.byRow.get(row.original.idx)?.values() ?? [])].map(
                            (t) => (
                              <ChildGrid key={t.column} table={t} />
                            )
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }
                const ordinal = item.ordinal;
                const childCols = lookup.byRow.get(row.original.idx);
                return (
                  <TableRow
                    key={row.id}
                    data-index={index}
                    ref={virtualize ? virtualizer.measureElement : undefined}
                    style={{ height: rowHeight }}
                    className={cn(
                      "group/row border-0 hover:bg-accent/60",
                      ordinal % 2 === 1 && "bg-muted/50"
                    )}
                  >
                    <TableCell
                      style={{ width: GUTTER_W }}
                      className="sticky left-0 z-10 border-b border-border bg-inherit px-0 text-center align-middle text-[10px] tabular-nums text-muted-foreground group-hover/row:bg-accent/60"
                    >
                      {ordinal + 1}
                    </TableCell>
                    {colPadLeft > 0 && (
                      <TableCell
                        style={{ width: colPadLeft, padding: 0 }}
                        className="border-b border-border"
                      />
                    )}
                    {(windowCols
                      ? virtualCols.map((vc) => row.getVisibleCells()[vc.index])
                      : row.getVisibleCells()
                    ).map(
                      // fallow-ignore-next-line complexity
                      (cell) => {
                      const text = cell.getValue<string>() ?? "";
                      const isExpandable =
                        viewMode === "expand" &&
                        lookup.childColumns.has(cell.column.id) &&
                        !!childCols?.has(cell.column.id);
                      if (isExpandable) {
                        const isOpen = expanded.has(row.original.idx);
                        return (
                          <TableCell
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                            className="border-b border-border px-3 align-middle"
                          >
                            <button
                              type="button"
                              aria-label={`${isOpen ? "Collapse" : "Expand"} ${cell.column.id}`}
                              onClick={() => toggleExpanded(row.original.idx)}
                              className="inline-flex cursor-pointer items-center gap-1 text-primary hover:underline"
                            >
                              {isOpen ? (
                                <ChevronDown size={12} />
                              ) : (
                                <ChevronRight size={12} />
                              )}
                              {text}
                            </button>
                          </TableCell>
                        );
                      }
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
                    {colPadRight > 0 && (
                      <TableCell
                        style={{ width: colPadRight, padding: 0 }}
                        className="border-b border-border"
                      />
                    )}
                  </TableRow>
                );
              })}
              {padBottom > 0 && (
                <tr>
                  <td colSpan={detailColSpan} style={{ height: padBottom }} />
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
