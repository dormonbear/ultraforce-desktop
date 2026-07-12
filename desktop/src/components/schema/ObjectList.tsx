import { memo, useMemo } from "react";
import type { SchemaObject } from "../../types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { filterObjects } from "./schemaFilter";
import { SchemaListFilter } from "./SchemaListFilter";
import { useVirtualRows } from "./useVirtualRows";

/**
 * Left pane of the schema browser: a filter box over the org's sObjects and a
 * flat, single-selection list. Virtualized (@tanstack/react-virtual) so the DOM
 * stays at a few dozen rows regardless of org size.
 */
export const ObjectList = memo(function ObjectList({
  objects,
  selected,
  filter,
  onFilterChange,
  onSelect,
}: {
  objects: SchemaObject[];
  selected: string | null;
  filter: string;
  onFilterChange: (q: string) => void;
  onSelect: (name: string) => void;
}) {
  const shown = useMemo(
    () => filterObjects(objects, filter),
    [objects, filter],
  );
  const { viewportRef, rowVirtualizer } = useVirtualRows(shown, selected, 40);

  return (
    <div className="flex h-full flex-col">
      <SchemaListFilter
        value={filter}
        onChange={onFilterChange}
        placeholder="Filter objects"
      />
      <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
        {shown.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground">
            No matching objects
          </div>
        ) : (
          <div className="p-1">
            <div
              style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const o = shown[vi.index];
                const active = o.name === selected;
                return (
                  <button
                    key={o.name}
                    data-index={vi.index}
                    ref={rowVirtualizer.measureElement}
                    type="button"
                    onClick={() => onSelect(o.name)}
                    aria-current={active ? "true" : undefined}
                    className={`focus-accent absolute left-0 top-0 flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left ${
                      active
                        ? "bg-primary/10 text-foreground shadow-[inset_2px_0_0_0_var(--primary)]"
                        : "text-text-dim hover:bg-secondary hover:text-foreground"
                    }`}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <span className="truncate font-mono text-[12px] font-medium">
                      {o.name}
                    </span>
                    {o.label && o.label !== o.name && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {o.label}
                      </span>
                    )}
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
