import { useLayoutEffect, useReducer, useRef, type RefObject } from "react";
import { usePanelActivity } from "../../panels/host/panelActivity";

/** Viewport geometry used by virtual-core. / virtual-core 使用的视口尺寸。 */
interface Remeasurable {
  scrollRect: { width: number; height: number } | null;
}

/**
 * Seed visible viewport geometry before paint, including a preheated hidden mount.
 * Preserve row measurements: measure() clears them and repeatedly compensates the
 * scroll offset for the same estimate-to-actual difference on every reveal.
 * Re-render with the new scrollRect so getVirtualItems() computes the visible range.
 * react-virtual is pinned; scrollRect is the instance field read by getSize().
 * 显示前填充视口尺寸，覆盖预热的隐藏挂载。保留行测量值：measure() 会清空它们，
 * 导致每次显示都为同一估算与实际尺寸差重复补偿滚动位置。使用新 scrollRect 重新渲染，
 * 让 getVirtualItems() 计算可见范围。react-virtual 版本已锁定，getSize() 读取该实例字段。
 */
export function useRemeasureOnVisible(
  viewportRef: RefObject<HTMLDivElement | null>,
  rowVirtualizer: Remeasurable,
): void {
  const { active } = usePanelActivity();
  const wasActive = useRef(active);
  const [, renderVisibleRange] = useReducer((revision: number) => revision + 1, 0);
  useLayoutEffect(() => {
    const becameVisible = active && !wasActive.current;
    wasActive.current = active;
    if (!becameVisible) return;
    const el = viewportRef.current;
    if (!el) return;
    const rect = { width: el.clientWidth, height: el.clientHeight };
    // An unchanged rect already has the correct range; retain the hot-switch fast path. / 尺寸不变时范围已正确，保留快速切换路径。
    const prev = rowVirtualizer.scrollRect;
    if (
      prev &&
      Math.abs(prev.width - rect.width) < 1 &&
      Math.abs(prev.height - rect.height) < 1
    ) {
      return;
    }
    rowVirtualizer.scrollRect = rect;
    renderVisibleRange();
  }, [active, rowVirtualizer, viewportRef]);
}
