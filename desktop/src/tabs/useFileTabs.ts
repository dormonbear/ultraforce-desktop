import { useCallback, useEffect, useRef, useState } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getJson, setJson } from "../store";
import { saveFile, writeFileNow } from "../fs/save";
import { basename, isWithin, normalizePath, rebasePath } from "../fs/paths";
import type { TabBase } from "./types";

type ReadTicket = { path: string; valid: boolean };

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
export function useFileTabs<T extends TabBase & { path: string }>(
  opts: Opts<T>,
) {
  const { tool, contentKey, make } = opts;
  const ext = tool === "apex" ? "apex" : "soql";
  const [tabs, setTabsState] = useState<T[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Untitled tabs live only in memory (path ""): no autosave, not persisted.
  const tabsRef = useRef<T[]>(tabs);
  const setTabs = useCallback((update: T[] | ((previous: T[]) => T[])) => {
    const next =
      typeof update === "function" ? update(tabsRef.current) : update;
    tabsRef.current = next;
    setTabsState(next);
  }, []);
  // Explorer double-clicks can arrive before the first disk read finishes.
  const openingFiles = useRef(new Map<string, Promise<T>>());
  const reads = useRef(new Set<ReadTicket>());
  // Only retained while the startup store/read operation is pending.
  const hydrationSkips = useRef<Set<string> | null>(null);
  const saving = useRef(new Map<string, Promise<void>>());
  const invalidate = useCallback((path: string) => {
    path = normalizePath(path);
    hydrationSkips.current?.add(path);
    for (const read of reads.current) {
      if (isWithin(read.path, path)) read.valid = false;
    }
    for (const opening of openingFiles.current.keys()) {
      if (isWithin(opening, path)) openingFiles.current.delete(opening);
    }
  }, []);
  const untitledCounter = useRef(0);
  // Transient request to scroll a tab's editor to a line (from content search).
  const [reveal, setReveal] = useState<{
    id: string;
    line: number;
    nonce: number;
  } | null>(null);
  const revealNonce = useRef(0);
  const [hydrated, setHydrated] = useState(false);
  const storeKey = `tabs.${tool}`;

  // Hydrate: read persisted open paths, load each file's content.
  useEffect(() => {
    let cancelled = false;
    const skipped = new Set<string>();
    hydrationSkips.current = skipped;
    void getJson<Persisted | null>(storeKey, null)
      .then(async (saved) => {
        if (cancelled) return;
        if (!saved || !Array.isArray(saved.openPaths)) {
          setHydrated(true);
          return;
        }
        const loaded: T[] = [];
        const restoring = new Map(
          saved.openPaths
            .filter((path) => typeof path === "string" && path !== "")
            .map((raw) => {
              const path = normalizePath(raw);
              return [path, { path, valid: true }];
            }),
        );
        for (const ticket of restoring.values()) reads.current.add(ticket);
        try {
          for (const path of restoring.keys()) {
            if (cancelled) return;
            try {
              loaded.push(make(path, await readTextFile(path)));
            } catch {
              /* file deleted out-of-band — skip */
            }
          }
          if (cancelled) return;
          // Restoration may finish after the user starts working. Keep live tab
          // identities/content (including untitled drafts), and add only missing paths.
          setTabs((current) => {
            const paths = new Set(current.map((t) => t.path));
            const restored = loaded.filter((t) => {
              if (
                !restoring.get(t.path)?.valid ||
                [...skipped].some((path) => isWithin(t.path, path))
              )
                return false;
              if (paths.has(t.path)) return false;
              paths.add(t.path);
              return true;
            });
            return [...restored, ...current];
          });
          const act =
            tabsRef.current.find(
              (t) =>
                t.path ===
                (typeof saved.activePath === "string"
                  ? normalizePath(saved.activePath)
                  : null),
            ) ?? tabsRef.current[0];
          setActiveId((current) => current ?? act?.id ?? null);
          setHydrated(true);
        } finally {
          for (const ticket of restoring.values()) reads.current.delete(ticket);
        }
      })
      .finally(() => {
        if (hydrationSkips.current === skipped) hydrationSkips.current = null;
      });
    return () => {
      cancelled = true;
      if (hydrationSkips.current === skipped) hydrationSkips.current = null;
    };
  }, [storeKey, make]);

  // Persist open paths + active path (never content).
  useEffect(() => {
    if (!hydrated) return;
    const active = tabs.find((t) => t.id === activeId) ?? null;
    void setJson<Persisted>(storeKey, {
      openPaths: tabs.filter((t) => t.path !== "").map((t) => t.path),
      activePath: active && active.path !== "" ? active.path : null,
    });
  }, [tabs, activeId, storeKey, hydrated]);

  const openFile = useCallback(
    async (path: string, line?: number) => {
      path = normalizePath(path);
      const fire = (id: string) => {
        if (line == null) return;
        revealNonce.current += 1;
        setReveal({ id, line, nonce: revealNonce.current });
      };
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        fire(existing.id);
        return;
      }
      let opening = openingFiles.current.get(path);
      const ticket = { path, valid: true };
      reads.current.add(ticket);
      try {
        if (!opening) {
          opening = readTextFile(path)
            .then((content) => make(path, content))
            .finally(() => {
              if (openingFiles.current.get(path) === opening)
                openingFiles.current.delete(path);
            });
          openingFiles.current.set(path, opening);
        }
        const loaded = await opening;
        // Validity is checked after IO because close/rename may happen during the read.
        if (ticket.valid) {
          const tab = tabsRef.current.find((t) => t.path === path) ?? loaded;
          // Publish the identity immediately: another open may resume in the same
          // React batch, before the tabs state has committed to the next render.
          if (!tabsRef.current.some((t) => t.path === path)) {
            setTabs((prev) =>
              prev.some((t) => t.path === path) ? prev : [...prev, tab],
            );
          }
          setActiveId(tab.id);
          fire(tab.id);
        }
      } finally {
        reads.current.delete(ticket);
      }
    },
    [make],
  );

  const close = useCallback((id: string) => {
    const path = tabsRef.current.find((t) => t.id === id)?.path;
    if (path) invalidate(path);
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) =>
        cur !== id
          ? cur
          : ((next[idx - 1] ?? next[idx] ?? next[0])?.id ?? null),
      );
      return next;
    });
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  // Re-insert a previously closed tab (powers "undo close" for unsaved tabs).
  const restore = useCallback((tab: T) => {
    setTabs((prev) =>
      prev.some((t) => t.id === tab.id) ? prev : [...prev, tab],
    );
    setActiveId(tab.id);
  }, []);

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
      path = normalizePath(path);
      const existing = tabsRef.current.find((t) => t.path === path);
      const tab = existing
        ? { ...existing, [contentKey]: content }
        : make(path, content);
      setTabs((prev) =>
        existing
          ? prev.map((t) => (t.id === tab.id ? tab : t))
          : [...prev, tab],
      );
      setActiveId(tab.id);
      await writeFileNow(path, content);
    },
    [make, contentKey, setTabs],
  );

  // Reflect external path changes (rename/move) on any open tab.
  const retitle = useCallback((from: string, to: string) => {
    from = normalizePath(from);
    to = normalizePath(to);
    invalidate(from);
    setTabs((prev) =>
      prev.map((t) =>
        isWithin(t.path, from)
          ? {
              ...t,
              path: rebasePath(t.path, from, to),
              title: basename(rebasePath(t.path, from, to)),
            }
          : t,
      ),
    );
  }, []);

  // Close a tab whose file was deleted.
  const closeByPath = useCallback((path: string) => {
    path = normalizePath(path);
    invalidate(path);
    setTabs((prev) => {
      const removed = prev.filter((t) => isWithin(t.path, path));
      const removedIds = new Set(removed.map((t) => t.id));
      const next = prev.filter((t) => !removedIds.has(t.id));
      setActiveId((cur) =>
        removed.some((t) => t.id === cur) ? (next[0]?.id ?? null) : cur,
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

  // Save a tab. A saved tab writes its live content and awaits IO; an untitled
  // tab prompts "Save As", writes the chosen path, and becomes a normal tab.
  const saveTab = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      if (tab.path !== "") {
        await writeFileNow(tab.path, String(tab[contentKey]));
        return;
      }
      const selected = await saveDialog({ defaultPath: `${tab.title}.${ext}` });
      if (!selected) return;
      const picked = normalizePath(selected);
      if (tabsRef.current.some((t) => t.id !== id && t.path === picked)) {
        throw new Error(
          "This file is already open. Save its tab or choose another path.",
        );
      }
      // The dialog and disk write may both outlive edits to the draft.
      // Keep writing the live content until it is stable before adopting the path.
      const persistDraft = async (target: string): Promise<void> => {
        const current = tabsRef.current.find((t) => t.id === id);
        if (!current) return;
        const content = String(current[contentKey]);
        const destination = await writeFileNow(target, content);
        const latest = tabsRef.current.find((t) => t.id === id);
        if (!latest) return;
        if (String(latest[contentKey]) !== content)
          return persistDraft(destination);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, path: destination, title: basename(destination) }
              : t,
          ),
        );
      };
      await persistDraft(picked);
    },
    [contentKey, ext],
  );

  const save = useCallback(
    (id: string): Promise<void> => {
      const existing = saving.current.get(id);
      if (existing) return existing;
      const request = saveTab(id).finally(() => saving.current.delete(id));
      saving.current.set(id, request);
      return request;
    },
    [saveTab],
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
    restore,
    select,
    patch,
    retitle,
    closeByPath,
  };
}
