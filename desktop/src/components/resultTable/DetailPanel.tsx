import { X } from "lucide-react";
import type { ChildLabelsDto, ChildTableDto } from "../../types";
import { RelationshipSection } from "./RecordCards";

/**
 * Side panel showing the selected parent row's subquery child tables. Replaces
 * the old inline between-row expansion: the main table stays stable on the left
 * while this renders one stacked section of vertical record cards per
 * relationship on the right (recursing into nested subqueries).
 */
export function DetailPanel({
  rowOrdinal,
  parentId,
  tables,
  childLabels,
  onClose,
}: {
  rowOrdinal: number;
  parentId: string | null;
  tables: ChildTableDto[];
  /** Per-relationship display labels (label mode); absent → API names. */
  childLabels?: Record<string, ChildLabelsDto>;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-2">
        <div className="min-w-0 truncate text-[12px] font-semibold text-foreground">
          Row {rowOrdinal + 1}
          {parentId && (
            <span className="ml-2 font-normal tabular-nums text-muted-foreground">
              {parentId}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Close detail panel"
          onClick={onClose}
          className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
      <div className="uf-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {tables.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No child records</div>
        ) : (
          tables.map((t) => (
            <RelationshipSection
              key={t.column}
              table={t}
              labels={childLabels?.[t.column]}
            />
          ))
        )}
      </div>
    </div>
  );
}
