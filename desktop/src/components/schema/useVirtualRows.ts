import { useEffect, useRef } from "react";
import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
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
    measureElement: (element, entry, instance) => {
      const size = measureElement(element, entry, instance);
      if (size > 0) return size;
      // Hidden rows report zero; preserve their geometry instead of shifting the scroll anchor. / 隐藏行报告零高度；保留其几何尺寸，避免滚动锚点位移。
      const key = instance.options.getItemKey(instance.indexFromElement(element));
      return instance.itemSizeCache.get(key) ?? estimateSize;
    },
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
