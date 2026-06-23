import { useCallback, useEffect, useRef, useState } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getJson, setJson } from "../store";
import { saveFile, flushFiles } from "../fs/save";
import { basename } from "../fs/paths";
import type { TabBase } from "./types";

interface Persisted {
  openPaths: string[];
  activePath: string | null;
}

interface Opts<T> {
  tool: "soql" | "apex";
  contentKey: keyof T;
  make: (path: string, content: string) => T;
}

/**
 * File-backed tabs: open paths persist (not content); each tab's content field
 * loads from disk on open and debounce-autosaves back on patch.
 */
export function useFileTabs<T extends TabBase & { path: string }>(opts: Opts<T>) {
  const { tool, contentKey, make } = opts;
  const ext = tool === "apex" ? "apex" : "soql";
  const [tabs, setTabs] = useState<T[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Untitled tabs live only in memory (path ""): no autosave, not persisted.
  const tabsRef = useRef<T[]>(tabs);
  tabsRef.current = tabs;
  const untitledCounter = useRef(0);
  // Transient request to scroll a tab's editor to a line (from content search).
  const [reveal, setReveal] = useState<{
    id: string;
    line: number;
    nonce: number;
  } | null>(null);
  const revealNonce = useRef(0);
  const hydrated = useRef(false);
  const storeKey = `tabs.${tool}`;

  // Hydrate: read persisted open paths, load each file's content.
  useEffect(() => {
    let cancelled = false;
    void getJson<Persisted | null>(storeKey, null).then(async (saved) => {
      if (cancelled || !saved || !Array.isArray(saved.openPaths)) {
        hydrated.current = true;
        return;
      }
      const loaded: T[] = [];
      for (const path of saved.openPaths) {
        try {
          loaded.push(make(path, await readTextFile(path)));
        } catch {
          /* file deleted out-of-band — skip */
        }
      }
      if (cancelled) return;
      setTabs(loaded);
      const act = loaded.find((t) => t.path === saved.activePath) ?? loaded[0];
      setActiveId(act?.id ?? null);
      hydrated.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [storeKey, make]);

  // Persist open paths + active path (never content).
  useEffect(() => {
    if (!hydrated.current) return;
    const active = tabs.find((t) => t.id === activeId) ?? null;
    void setJson<Persisted>(storeKey, {
      openPaths: tabs.filter((t) => t.path !== "").map((t) => t.path),
      activePath: active && active.path !== "" ? active.path : null,
    });
  }, [tabs, activeId, storeKey]);

  const openFile = useCallback(
    async (path: string, line?: number) => {
      const fire = (id: string) => {
        if (line == null) return;
        revealNonce.current += 1;
        setReveal({ id, line, nonce: revealNonce.current });
      };
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        fire(existing.id);
        return;
      }
      const tab = make(path, await readTextFile(path));
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
      fire(tab.id);
    },
    [tabs, make],
  );

  const close = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) =>
        cur !== id ? cur : (next[idx - 1] ?? next[idx] ?? next[0])?.id ?? null,
      );
      return next;
    });
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  const patch = useCallback(
    (id: string, partial: Partial<T>) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const updated = { ...t, ...partial };
          // Autosave only when the content field changed on a saved (path) tab;
          // untitled tabs (path "") are held in memory until "Save As".
          if (contentKey in partial && updated.path !== "") {
            saveFile(updated.path, String(updated[contentKey]));
          }
          return updated;
        }),
      );
    },
    [contentKey],
  );

  // Write `content` to `path` and show it (used by "open from history"):
  // patch an already-open tab, otherwise open a fresh one.
  const openOrReplace = useCallback(
    async (path: string, content: string) => {
      await writeTextFile(path, content);
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        patch(existing.id, { [contentKey]: content } as Partial<T>);
        setActiveId(existing.id);
        return;
      }
      const tab = make(path, content);
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
    },
    [tabs, make, patch, contentKey],
  );

  // Reflect external path changes (rename/move) on any open tab.
  const retitle = useCallback((from: string, to: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.path === from ? { ...t, path: to, title: basename(to) } : t,
      ),
    );
  }, []);

  // Close a tab whose file was deleted.
  const closeByPath = useCallback((path: string) => {
    setTabs((prev) => {
      const t = prev.find((x) => x.path === path);
      if (!t) return prev;
      const idx = prev.findIndex((x) => x.id === t.id);
      const next = prev.filter((x) => x.id !== t.id);
      setActiveId((cur) =>
        cur !== t.id ? cur : (next[idx - 1] ?? next[idx] ?? next[0])?.id ?? null,
      );
      return next;
    });
  }, []);

  // Open a new in-memory untitled tab (no path until "Save As").
  const newUntitled = useCallback(() => {
    untitledCounter.current += 1;
    const tab: T = {
      ...make("", ""),
      title: `Untitled-${untitledCounter.current}`,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, [make]);

  // Save a tab. A saved tab just flushes its debounced autosave; an untitled
  // tab prompts "Save As", writes the chosen path, and becomes a normal tab.
  const save = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      if (tab.path !== "") {
        await flushFiles();
        return;
      }
      const picked = await saveDialog({ defaultPath: `${tab.title}.${ext}` });
      if (!picked) return;
      await writeTextFile(picked, String(tab[contentKey]));
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, path: picked, title: basename(picked) } : t,
        ),
      );
    },
    [contentKey, ext],
  );

  const active = tabs.find((t) => t.id === activeId) ?? null;
  return {
    tabs,
    active,
    activeId,
    reveal,
    openFile,
    openOrReplace,
    newUntitled,
    save,
    close,
    select,
    patch,
    retitle,
    closeByPath,
  };
}
