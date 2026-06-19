import { useCallback, useRef, useState } from "react";
import type { TabBase } from "./types";

/**
 * Owns an array of tabs + the active id. Generic over the per-tool tab type.
 * `make(n)` builds a fresh tab given the next monotonic number (for the title).
 */
export function useTabs<T extends TabBase>(make: (n: number) => T) {
  // Monotonic counter so closing then adding never reuses a number.
  const counter = useRef(1);
  const first = make(counter.current);
  const [tabs, setTabs] = useState<T[]>([first]);
  const [activeId, setActiveId] = useState<string>(first.id);

  const add = useCallback(() => {
    counter.current += 1;
    const tab = make(counter.current);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, [make]);

  const close = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev; // min one tab — no-op
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const neighbor = next[idx - 1] ?? next[idx] ?? next[0];
        return neighbor.id;
      });
      return next;
    });
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  const patch = useCallback((id: string, partial: Partial<T>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    );
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return { tabs, active, activeId, add, close, select, patch };
}
