import { memo, useMemo } from "react";
import type { SchemaField } from "../../types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { filterFields } from "./schemaFilter";
import { SchemaListFilter } from "./SchemaListFilter";
import { useVirtualRows } from "./useVirtualRows";

/** Human-readable type label, e.g. `reference→Account` for lookups. */
function typeLabel(f: SchemaField): string {
  if (f.referenceTo.length > 0) return `reference→${f.referenceTo.join(", ")}`;
  return f.fieldType;
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded bg-secondary px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function attributeChips(f: SchemaField): string[] {
  const chips: string[] = [];
  if (!f.nillable) chips.push("required");
  if (f.unique) chips.push("unique");
  if (f.calculated) chips.push("formula");
  return chips;
}

/**
 * Middle pane of the schema browser: the selected object's fields as rows —
 * API name, label, a type badge (reference targets inlined), picklist size,
 * and attribute chips (required / unique / formula).
 */
export const FieldTable = memo(function FieldTable({
  fields,
  loading,
  selected,
  filter,
  onFilterChange,
  onSelect,
}: {
  fields: SchemaField[];
  loading: boolean;
  selected: string | null;
  filter: string;
  onFilterChange: (q: string) => void;
  onSelect: (name: string) => void;
}) {
  const shown = useMemo(() => filterFields(fields, filter), [fields, filter]);
  const { viewportRef, rowVirtualizer } = useVirtualRows(shown, selected, 44);

  return (
    <div className="flex h-full flex-col">
      <SchemaListFilter
        value={filter}
        onChange={onFilterChange}
        placeholder="Filter fields"
      />
      <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
        {loading ? (
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="h-9 animate-pulse rounded bg-secondary"
              />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-muted-foreground">
            No matching fields
          </div>
        ) : (
          <div className="p-1">
            <div
              style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const f = shown[vi.index];
                const active = f.name === selected;
                const chips = attributeChips(f);
                return (
                  <button
                    key={f.name}
                    data-index={vi.index}
                    ref={rowVirtualizer.measureElement}
                    type="button"
                    onClick={() => onSelect(f.name)}
                    aria-current={active ? "true" : undefined}
                    className={`focus-accent absolute left-0 top-0 flex w-full items-center gap-3 rounded px-2 py-1.5 text-left ${
                      active
                        ? "bg-accent text-foreground"
                        : "text-text-dim hover:bg-secondary hover:text-foreground"
                    }`}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12px] font-medium">
                        {f.name}
                      </div>
                      {f.label && f.label !== f.name && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {f.label}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {chips.map((c) => (
                        <Chip key={c}>{c}</Chip>
                      ))}
                      {f.picklistValues.length > 0 && (
                        <Chip>{`${f.picklistValues.length} values`}</Chip>
                      )}
                      <span className="rounded bg-secondary px-1.5 py-px font-mono text-[10px] text-foreground">
                        {typeLabel(f)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
