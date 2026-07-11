import { useMemo } from "react";
import { Search } from "lucide-react";
import type { SchemaObject } from "../../types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { filterObjects } from "./schemaFilter";

/**
 * Left pane of the schema browser: a filter box over the org's sObjects and a
 * flat, single-selection list. A plain list is fine for the few-thousand-row
 * scale we deal with here.
 */
export function ObjectList({
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

  return (
    <div className="flex h-full flex-col">
      <div className="relative shrink-0 border-b border-border p-2">
        <Search
          size={13}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter objects"
          aria-label="Filter objects"
          className="focus-accent w-full rounded-md border border-border bg-input py-1 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="p-1">
          {shown.length === 0 ? (
            <li className="px-2 py-2 text-[12px] text-muted-foreground">
              No matching objects
            </li>
          ) : (
            shown.map((o) => {
              const active = o.name === selected;
              return (
                <li key={o.name}>
                  <button
                    type="button"
                    onClick={() => onSelect(o.name)}
                    aria-current={active ? "true" : undefined}
                    className={`focus-accent flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left ${
                      active
                        ? "bg-accent text-foreground"
                        : "text-text-dim hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    <span className="truncate text-[12px] font-medium">
                      {o.name}
                    </span>
                    {o.label && o.label !== o.name && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {o.label}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}
