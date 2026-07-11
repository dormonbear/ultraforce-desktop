import type { ReactNode } from "react";
import type { Column } from "@tanstack/react-table";
import { Check } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GridRow } from "../ResultTable";
import type { QuickMode } from "./quickFilter";

/** Fixed-width slot so items align whether or not the checkmark shows. */
function CheckSlot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex w-4 shrink-0 items-center">
      {active && <Check size={12} />}
    </span>
  );
}

/**
 * Right-click context menu for one result-table column header. Sort/copy for
 * every column; subquery columns add a mutually-exclusive child-presence quick
 * filter (sugar over the advanced filter — see `quickFilter.ts`).
 */
export function HeaderContextMenu({
  column,
  isChildColumn,
  quickMode,
  onQuickFilter,
  onCopy,
  children,
}: {
  column: Column<GridRow>;
  isChildColumn: boolean;
  quickMode: QuickMode | null;
  onQuickFilter: (mode: QuickMode | null) => void;
  onCopy: () => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => column.toggleSorting(false)}>
          Sort ascending
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => column.toggleSorting(true)}>
          Sort descending
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => column.clearSorting()}>
          Clear sort
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCopy}>Copy column</ContextMenuItem>
        {isChildColumn && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => onQuickFilter(quickMode === "some" ? null : "some")}
            >
              <CheckSlot active={quickMode === "some"} />
              Only with child records
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => onQuickFilter(quickMode === "none" ? null : "none")}
            >
              <CheckSlot active={quickMode === "none"} />
              Only without child records
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
