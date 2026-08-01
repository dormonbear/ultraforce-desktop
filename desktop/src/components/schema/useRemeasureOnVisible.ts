import { useLayoutEffect, useRef, type RefObject } from "react";
import { usePanelActivity } from "../../panels/host/panelActivity";

/** Minimal virtual-core surface this hook pokes — a Virtualizer satisfies it. */
interface Remeasurable {
  scrollRect: { width: number; height: number } | null;
  measure: () => void;
}

/**
 * Kill the first-show blank frame for a virtualizer that mounted under
 * `display:none` (a preheated, hidden panel). While the panel is hidden its
 * ScrollArea viewport has 0 height, so the virtualizer measured an empty range;
 * its own ResizeObserver only re-measures one frame *after* the panel is shown
 * (async), so the first painted frame would be blank.
 *
 * On the hidden→visible transition we re-seed the virtualizer's container rect
 * from the now-laid-out viewport and force a synchronous re-measure, so rows are
 * committed in the SAME frame the panel becomes visible. This runs in a layout
 * effect (before paint); the panel-switch click flushes it synchronously, so the
 * measure lands before the browser paints frame 1.
 *
 * `scrollRect` is the virtual-core instance field its `getSize()` reads when it
 * recomputes the range; `measure()` then triggers the re-render. react-virtual
 * is pinned, so writing the field here is safe.
 */
export function useRemeasureOnVisible(
  viewportRef: RefObject<HTMLDivElement | null>,
  rowVirtualizer: Remeasurable,
): void {
  const { active } = usePanelActivity();
  const wasActive = useRef(active);
  useLayoutEffect(() => {
    const becameVisible = active && !wasActive.current;
    wasActive.current = active;
    if (!becameVisible) return;
    const el = viewportRef.current;
    if (!el) return;
    const rect = { width: el.clientWidth, height: el.clientHeight };
    // Hot-switch fast path: a kept-alive hidden panel keeps its virtualizer
    // instance and last-measured rect. If the pane dimensions are unchanged
    // since the previous reveal, the committed range is already correct — the
    // rows are in the DOM, just hidden — so force a synchronous re-measure
    // would only re-render the visible rows in the same frame as the click,
    // adding to the reveal cost for zero change. Skip it. The blank-frame
    // guarantee is unaffected: first mount (or a real resize) has a stale/null
    // rect and still goes through the measure path.
    const prev = rowVirtualizer.scrollRect;
    if (
      prev &&
      Math.abs(prev.width - rect.width) < 1 &&
      Math.abs(prev.height - rect.height) < 1
    ) {
      return;
    }
    rowVirtualizer.scrollRect = rect;
    rowVirtualizer.measure();
  }, [active, rowVirtualizer, viewportRef]);
}
