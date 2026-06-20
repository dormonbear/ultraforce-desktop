import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, setJson } from "../store";
import type { TabBase } from "./types";

interface PersistOpts<T> {
  /** Store sub-key; persists under `tabs.<storeKey>`. Omit to disable. */
  storeKey?: string;
  /**
   * Maps a tab to its persisted form (e.g. to drop oversized results).
   * MUST be stable (wrap in useCallback). Defaults to identity.
   */
  serialize?: (tab: T) => T;
}

interface Persisted<T> {
  tabs: T[];
  activeId: string;
}

const identity = <T,>(t: T): T => t;

/**
 * Owns an array of tabs + the active id. Generic over the per-tool tab type.
 * `make(n)` builds a fresh tab given the next monotonic number (for the title).
 * When `storeKey` is given, tabs hydrate from and autosave to the store.
 */
export function useTabs<T extends TabBase>(
  make: (n: number) => T,
  opts: PersistOpts<T> = {},
) {
  const { storeKey, serialize = identity } = opts;
  // Monotonic counter so closing then adding never reuses a number.
  const counter = useRef(1);
  // Lazy init so the first tab is built exactly once (not every render).
  const [tabs, setTabs] = useState<T[]>(() => [make(counter.current)]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);
  // Gate autosave until hydration has run, so the default tab never clobbers
  // persisted state on first paint.
  const hydrated = useRef(!storeKey);

  useEffect(() => {
    if (!storeKey) return;
    let cancelled = false;
    void getJson<Persisted<T> | null>(`tabs.${storeKey}`, null).then((saved) => {
      if (cancelled) return;
      if (saved && saved.tabs.length > 0) {
        counter.current = saved.tabs.length;
        setTabs(saved.tabs);
        const exists = saved.tabs.some((t) => t.id === saved.activeId);
        setActiveId(exists ? saved.activeId : saved.tabs[0].id);
      }
      hydrated.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [storeKey]);

  useEffect(() => {
    if (!storeKey || !hydrated.current) return;
    void setJson<Persisted<T>>(`tabs.${storeKey}`, {
      tabs: tabs.map(serialize),
      activeId,
    });
  }, [tabs, activeId, storeKey, serialize]);

  const add = useCallback(() => {
    counter.current += 1;
    const tab = make(counter.current);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, [make]);

  /** Append a fresh tab pre-filled with `init` and activate it. */
  const openWith = useCallback(
    (init: Partial<T>) => {
      counter.current += 1;
      const tab = { ...make(counter.current), ...init };
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
    },
    [make],
  );

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

  const rename = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, title: trimmed, renamed: true } : t,
      ),
    );
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return { tabs, active, activeId, add, openWith, close, select, patch, rename };
}
