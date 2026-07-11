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
import { ArrowDown, ArrowUp, ChevronsUpDown, Copy } from "lucide-react";
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import type { SoqlResultDto } from "../types";
import { buildChildLookup } from "./resultTable/childData";
import { computeFillRatio } from "./resultTable/fill";
import { flattenTable } from "./resultTable/flatten";
import { DetailPanel } from "./resultTable/DetailPanel";
import { CellContextMenu } from "./resultTable/CellMenu";
import { HeaderContextMenu } from "./resultTable/HeaderMenu";
import { getQuickMode, setQuickFilter } from "./resultTable/quickFilter";
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
  // Text of the last right-clicked cell — feeds the shared cell context menu.
  const [cellMenuText, setCellMenuText] = useState("");
  // Original index (`row.original.idx`) of the row whose subquery detail panel
  // is open, or null when no row is selected.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"expand" | "flatten">("expand");
  // Advanced filter rules; `activeIdx` below applies them to the visible rows.
  const [advancedFilter, setAdvancedFilter] = useState<RuleGroupType>(
    initialAdvancedFilter ?? { combinator: "and", rules: [] },
  );
  const [showFilter, setShowFilter] = useState(false);

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

  // Natural column widths often undershoot the container, leaving the right
  // half empty while narrow columns truncate. Stretch every rendered width by
  // this ratio at render time (never shrinking below natural size) so the
  // table fills the container; manual resize recomputes it from the new totals.
  const totalColW = table.getCenterTotalSize();
  const fillRatio = computeFillRatio(containerW, GUTTER_W, totalColW);

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

  // Rows are fixed-height (subquery detail moved to the side panel), so we
  // virtualize the table rows directly with a constant row height.
  const virtualize = tableRows.length > 100;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: virtualize,
  });

  // The detail panel opens for a selected row in Nested mode. Selection tracks
  // the original row index; find its current ordinal in the visible rows (a
  // selected row filtered out closes the panel).
  const selectedOrdinal =
    selectedIdx == null
      ? -1
      : tableRows.findIndex((r) => r.original.idx === selectedIdx);
  const panelOpen = viewMode === "expand" && selectedOrdinal >= 0;

  // Close the panel on Esc while it is open.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIdx(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

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
    estimateSize: (i) => visibleColumns[i].getSize() * fillRatio,
    overscan: 6,
    enabled: colVirtualize,
  });
  // Column widths change on resize/visibility/fill — remeasure.
  useEffect(() => {
    colVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalColW, visibleColumns.length, fillRatio]);

  /** Copy one column's visible values (respects filter/sort). */
  const copyColumn = (col: string) => {
    const vals = table.getRowModel().rows.map((r) => String(r.getValue(col) ?? ""));
    void copyText(
      vals.join("\n"),
      `Copied ${vals.length} ${col} value${vals.length === 1 ? "" : "s"}`,
    );
  };

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
    ? virtualItems.map((vi) => ({
        row: tableRows[vi.index],
        ordinal: vi.index,
        index: vi.index,
      }))
    : tableRows.map((row, index) => ({ row, ordinal: index, index }));

  const virtualCols = colVirtualizer.getVirtualItems();
  // Only window once the virtualizer has actually measured a viewport and
  // produced items; before that (or when disabled) render every column, which
  // keeps below-threshold output identical and avoids a blank first paint.
  const windowCols = colVirtualize && virtualCols.length > 0;
  const colPadLeft = windowCols ? virtualCols[0].start : 0;
  const colPadRight = windowCols
    ? colVirtualizer.getTotalSize() - virtualCols[virtualCols.length - 1].end
    : 0;
  // Full-width vertical spacer rows must cover the gutter, the windowed cells,
  // and any left/right spacer cells.
  const spacerColSpan = windowCols
    ? virtualCols.length + (colPadLeft > 0 ? 1 : 0) + (colPadRight > 0 ? 1 : 0) + 1
    : visibleLeafCount + 1;

  const tableWidth = Math.max(containerW, GUTTER_W + totalColW * fillRatio);
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
          setSelectedIdx(null);
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
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="uf-result-table" minSize="200px">
          <div
            ref={parentRef}
            onScroll={syncBarFromBody}
            onWheel={onBodyWheel}
            className="uf-scroll select-text h-full overflow-y-auto overflow-x-hidden border-t border-border"
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
                      <HeaderContextMenu
                        key={header.id}
                        column={header.column}
                        isChildColumn={lookup.childColumns.has(header.column.id)}
                        quickMode={getQuickMode(advancedFilter, header.column.id)}
                        onQuickFilter={(m) =>
                          setAdvancedFilter((f) =>
                            setQuickFilter(f, header.column.id, m),
                          )
                        }
                        onCopy={() => copyColumn(header.column.id)}
                      >
                      <TableHead
                        style={{ width: header.getSize() * fillRatio }}
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                        }
                        className="group relative sticky top-0 z-20 h-8 select-none border-b border-border bg-secondary px-3 text-left align-middle font-semibold text-muted-foreground"
                      >
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex max-w-full items-center gap-1 truncate hover:text-foreground cursor-pointer"
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
                            copyColumn(header.column.id);
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
                      </HeaderContextMenu>
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
            <CellContextMenu text={cellMenuText}>
            <TableBody>
              {padTop > 0 && (
                <tr onContextMenu={(e) => e.stopPropagation()}>
                  <td colSpan={spacerColSpan} style={{ height: padTop }} />
                </tr>
              )}
              {renderItems.map(
                // fallow-ignore-next-line complexity
                ({ row, ordinal, index }) => {
                const childCols = lookup.byRow.get(row.original.idx);
                const isSelected = row.original.idx === selectedIdx;
                return (
                  <TableRow
                    key={row.id}
                    data-index={index}
                    onClick={() =>
                      setSelectedIdx((cur) =>
                        cur === row.original.idx ? null : row.original.idx
                      )
                    }
                    style={{ height: rowHeight }}
                    className={cn(
                      "group/row cursor-pointer border-0 hover:bg-accent/60",
                      ordinal % 2 === 1 && !isSelected && "bg-muted/50",
                      isSelected && "bg-accent"
                    )}
                  >
                    <TableCell
                      // No value to copy here — keep the cell menu closed.
                      onContextMenu={(e) => e.stopPropagation()}
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
                      const isChildCol =
                        viewMode === "expand" &&
                        lookup.childColumns.has(cell.column.id);
                      if (isChildCol) {
                        const hasChildren = !!childCols?.has(cell.column.id);
                        return (
                          <TableCell
                            key={cell.id}
                            onContextMenu={() => setCellMenuText(text)}
                            style={{ width: cell.column.getSize() * fillRatio }}
                            className="border-b border-border px-3 align-middle"
                          >
                            {hasChildren ? (
                              <span className="inline-flex min-w-5 items-center justify-center rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                                {text}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell
                          key={cell.id}
                          // Right-click copies via the shared cell menu;
                          // left-click bubbles to the row (selection).
                          onContextMenu={() => setCellMenuText(text)}
                          style={{ width: cell.column.getSize() * fillRatio }}
                          className={cn(
                            "max-w-0 truncate border-b border-border px-3 align-middle text-foreground",
                            numeric(cell.column)
                              ? "text-right tabular-nums"
                              : "text-left"
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
                <tr onContextMenu={(e) => e.stopPropagation()}>
                  <td colSpan={spacerColSpan} style={{ height: padBottom }} />
                </tr>
              )}
            </TableBody>
            </CellContextMenu>
          </Table>
          </div>
          </ResizablePanel>
          {panelOpen && (
            <>
              <ResizableHandle />
              <ResizablePanel
                id="uf-result-detail"
                defaultSize="40%"
                minSize="240px"
              >
                <DetailPanel
                  rowOrdinal={selectedOrdinal}
                  parentId={
                    data.columns.includes("Id")
                      ? tableRows[selectedOrdinal].original.cells["Id"] ?? null
                      : null
                  }
                  tables={[
                    ...(lookup.byRow.get(selectedIdx as number)?.values() ?? []),
                  ]}
                  onClose={() => setSelectedIdx(null)}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
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
