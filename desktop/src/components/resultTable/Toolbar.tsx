import type { Dispatch, SetStateAction } from "react";
import type { Table } from "@tanstack/react-table";
import type { VisibilityState } from "@tanstack/react-table";
import { Copy, Download, Filter, Loader2, Search, SlidersHorizontal } from "lucide-react";
import type { RuleGroupType } from "react-querybuilder";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EXPORT_FORMATS, type ExportFormatDef } from "../export";

/** Left-clicking the export button runs this format directly (no menu). */
const CSV_FORMAT = EXPORT_FORMATS.find((f) => f.id === "csv") ?? EXPORT_FORMATS[0];
import type { FlatTable } from "./flatten";
import type { ChildLookup } from "./childData";
import type { GridRow } from "../ResultTable";

interface ToolbarProps {
  globalFilter: string;
  onGlobalFilterChange: (v: string) => void;
  table: Table<GridRow>;
  viewMode: "expand" | "flatten";
  onViewModeChange: (m: "expand" | "flatten") => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: Dispatch<SetStateAction<VisibilityState>>;
  flat: FlatTable;
  lookup: ChildLookup;
  showFilter: boolean;
  onToggleFilter: () => void;
  labelMode: boolean;
  /** True while the first label lookup is in flight (spinner on the Aa button). */
  labelsLoading?: boolean;
  /** Absent → the label toggle is hidden (no query to resolve labels from). */
  onToggleLabelMode?: () => void;
  advancedFilter: RuleGroupType;
  copyAs: (kind: "tsv" | "md" | "json") => void;
  exportAs: (fmt: ExportFormatDef) => void | Promise<void>;
  shownCount: number;
  totalSize: number;
}

// fallow-ignore-next-line complexity
export function Toolbar({
  globalFilter,
  onGlobalFilterChange,
  table,
  viewMode,
  onViewModeChange,
  columnVisibility,
  onColumnVisibilityChange,
  flat,
  lookup,
  showFilter,
  onToggleFilter,
  labelMode,
  labelsLoading,
  onToggleLabelMode,
  advancedFilter,
  copyAs,
  exportAs,
  shownCount,
  totalSize,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div>
        <TextInput
          label="Filter rows"
          isLabelHidden
          value={globalFilter}
          onChange={(value) => onGlobalFilterChange(value)}
          placeholder="Filter rows…"
          data-uf-search=""
          size="sm"
          startIcon={<Search className="size-3.5" />}
          width={224}
          className="text-[12px]"
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="focus-accent inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-[12px] text-muted-foreground hover:text-foreground cursor-pointer">
          <SlidersHorizontal size={13} /> Columns
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
          <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
          {(() => {
            // In flatten mode the generated `rel[k].col` position columns are
            // hidden from the individual list and toggled as one group each.
            const grouped = new Set(
              viewMode === "flatten" ? flat.groups.flatMap((g) => g.columns) : [],
            );
            const setGroup = (cols: string[], v: boolean) =>
              onColumnVisibilityChange((old) => ({
                ...old,
                ...Object.fromEntries(cols.map((c) => [c, v])),
              }));
            return (
              <>
                {table
                  .getAllLeafColumns()
                  .filter((col) => !grouped.has(col.id))
                  .map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={col.getIsVisible()}
                      onCheckedChange={(v) => col.toggleVisibility(!!v)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {col.id}
                    </DropdownMenuCheckboxItem>
                  ))}
                {viewMode === "flatten" &&
                  flat.groups.map((g) => (
                    <DropdownMenuCheckboxItem
                      key={g.relationship}
                      checked={g.columns.every((c) => columnVisibility[c] !== false)}
                      onCheckedChange={(v) => setGroup(g.columns, !!v)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {`${g.relationship} (${g.columns.length} cols)`}
                    </DropdownMenuCheckboxItem>
                  ))}
              </>
            );
          })()}
        </DropdownMenuContent>
      </DropdownMenu>

      {onToggleLabelMode && (
        <button
          type="button"
          aria-label="Show field labels"
          aria-pressed={labelMode}
          aria-busy={labelsLoading || undefined}
          onClick={onToggleLabelMode}
          className={cn(
            "focus-accent inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-input bg-card px-2.5 text-[12px]",
            labelMode ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Aa
          {labelsLoading && (
            // Delayed reveal: fast lookups never flash a spinner (150ms gate).
            <span className="uf-delay-in inline-flex" aria-hidden>
              <Loader2 size={12} className="spin" />
            </span>
          )}
        </button>
      )}

      <button
        type="button"
        aria-label="Advanced filter"
        onClick={onToggleFilter}
        className={cn(
          "focus-accent relative inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-[12px] cursor-pointer",
          showFilter || advancedFilter.rules.length > 0
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Filter size={13} /> Filter
        {advancedFilter.rules.length > 0 && (
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-primary" />
        )}
      </button>

      {lookup.relationships.length > 0 && (
        <div className="flex h-7 items-center rounded-md border border-input bg-card p-0.5 text-[12px]">
          {(["expand", "flatten"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onViewModeChange(m)}
              className={cn(
                "cursor-pointer rounded px-2 py-0.5",
                viewMode === m
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "expand" ? "Nested" : "Flat"}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1" />

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            aria-label="Copy result"
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            aria-label="Export"
            onClick={() => void exportAs(CSV_FORMAT)}
            className="focus-accent inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <Download size={14} />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {EXPORT_FORMATS.map((fmt) => (
            <ContextMenuItem key={fmt.id} onSelect={() => void exportAs(fmt)}>
              Export as {fmt.label}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      {/* Only shown when the visible set differs from the full result (filtered
          or partially loaded); the full count lives in the panel status line. */}
      {shownCount !== totalSize && (
        <span className="tnum text-[11px] text-muted-foreground">
          {shownCount.toLocaleString()} / {totalSize.toLocaleString()} shown
        </span>
      )}
    </div>
  );
}
