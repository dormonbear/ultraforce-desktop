import { useEffect, useRef } from "react";
import {
  useDefaultLayout,
  useGroupRef,
  type Layout,
} from "react-resizable-panels";

/**
 * Shared sidebar layout for the SOQL and Apex tab panels. Both pages use one
 * persistence key (so widths match after reload) and one in-memory channel:
 * resizing the sidebar on one page live-updates the other via the group's
 * imperative `setLayout`.
 *
 * The inactive page is `display:none` (App keeps panels mounted), where a
 * pixel-constrained `setLayout` can't measure its container. So we also
 * re-apply the shared layout whenever a panel transitions hidden→visible,
 * which makes switching pages always land on the shared width.
 */
const KEY = "uf-tabs-sidebar";
const PANEL_IDS = ["sidebar", "main"];

let current: Layout | undefined;
const subs = new Set<(l: Layout, origin: object) => void>();

/** Layouts equal within a tolerance (avoids the setLayout→onLayoutChanged echo loop). */
function eq(a?: Layout, b?: Layout): boolean {
  if (!a || !b) return a === b;
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => Math.abs(a[k] - (b[k] ?? NaN)) < 0.01)
  );
}

export function useSidebarSync() {
  const groupRef = useGroupRef();
  const elementRef = useRef<HTMLDivElement | null>(null);
  const token = useRef({}).current;
  const ld = useDefaultLayout({
    id: KEY,
    panelIds: PANEL_IDS,
    storage: localStorage,
  });
  if (current === undefined && ld.defaultLayout) current = ld.defaultLayout;

  // Live channel: receive the other page's resize and mirror it.
  useEffect(() => {
    const apply = (l: Layout, origin: object) => {
      if (origin === token) return;
      groupRef.current?.setLayout(l);
    };
    subs.add(apply);
    if (current) groupRef.current?.setLayout(current);
    return () => {
      subs.delete(apply);
    };
  }, [groupRef, token]);

  // Re-apply the shared width when this panel becomes visible (0→positive).
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    let lastW = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth;
      if (lastW === 0 && w > 0 && current) groupRef.current?.setLayout(current);
      lastW = w;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [groupRef]);

  const onLayoutChanged = (l: Layout) => {
    if (eq(l, current)) return; // echo from a programmatic setLayout — ignore
    current = l;
    ld.onLayoutChanged(l); // persist
    for (const fn of subs) fn(l, token); // live-sync the other page
  };

  return {
    groupRef,
    elementRef,
    defaultLayout: current ?? ld.defaultLayout,
    onLayoutChanged,
  };
}
