import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { copyText } from "../../clipboard";

/**
 * One shared right-click menu for every result cell: the trigger wraps the
 * whole table body (a single Radix root instead of one per cell — results can
 * reach tens of thousands of cells); each value cell records its text via
 * `onContextMenu` just before the menu opens.
 */
export function CellContextMenu({
  text,
  children,
}: {
  text: string;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void copyText(text, "Copied cell value")}>
          Copy value
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
