import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRemeasureOnVisible } from "./useRemeasureOnVisible";

/**
 * Shared virtualization scaffolding for the schema browser's list panes
 * (ObjectList, FieldTable). Virtualizes over a ScrollArea's real viewport and
 * keeps the selected row in view — the target may be unmounted under
 * virtualization (external schema nav / deep search), and re-runs on `items`
 * change so the selection stays visible against the filtered index.
 *
 * Rows vary in height (label present or not), so `estimateSize` is a floor and
 * `measureElement` (attached by the caller via `rowVirtualizer.measureElement`)
 * refines it.
 */
export function useVirtualRows<T extends { name: string }>(
  items: T[],
  selected: string | null,
  estimateSize: number,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => estimateSize,
    overscan: 12,
  });

  useEffect(() => {
    if (selected == null) return;
    const idx = items.findIndex((it) => it.name === selected);
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: "auto" });
  }, [selected, items, rowVirtualizer]);

  // Re-measure on the hidden→visible transition so a preheated panel shows rows
  // on the first frame (no blank frame — see useRemeasureOnVisible).
  useRemeasureOnVisible(viewportRef, rowVirtualizer);

  return { viewportRef, rowVirtualizer };
}
