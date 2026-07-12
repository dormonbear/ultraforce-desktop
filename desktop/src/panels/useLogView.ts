import { useCallback, useEffect, useRef, useState } from "react";
import { formatIpcError } from "../errorFormat";
import { clearApexSourceCache } from "../components/useApexSource";
import { listCachedIds, fetchLogView } from "./logCache";
import { parseLogView, sourceLineIndices } from "../ipc/logs";
import type { SourceRef } from "./sourceRef";
import type { DetailTab } from "./logDetail/types";
import type { LogRefDto, LogViewDto } from "../types";

/** Selected-log view state: cache-first body loading, parse, tab selection,
 * Apex-source line resolution, and the local (drag-dropped, orgless) path. */
// fallow-ignore-next-line complexity
export function useLogView(org: string | null) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<LogViewDto | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  // Raw-line indices that resolve to Apex source — drives which raw-view lines
  // render as clickable (see LogView's jumpableLines).
  const [sourceLines, setSourceLines] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<DetailTab>("raw");
  // True when the shown log came from drag-drop (no org) — disables Apex
  // source navigation, which needs an org to resolve class/trigger bodies.
  const [orgless, setOrgless] = useState(false);
  // Apex source to show (jump-to-source from a method node / hotspot).
  const [sourceRef, setSourceRef] = useState<SourceRef | null>(null);

  // Parsed-log cache (logs are immutable once written). Avoids re-fetching a
  // large log from the org on every click; cleared on org switch / REFRESH.
  const viewCache = useRef<Map<string, LogViewDto>>(new Map());
  // Id of the log whose Apex source cache is currently held (null = local file).
  const lastLogId = useRef<string | null>(null);
  // Log ids whose body is cached on disk — drives the "downloaded" list marker.
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void listCachedIds().then(setCachedIds);
  }, []);

  /** Drop all per-log state on org switch: selection, parsed view, and the
   * Apex source cache (a different org has different source). */
  const resetForOrg = useCallback(() => {
    setSelectedId(null);
    setView(null);
    setSourceLines(new Set());
    setViewError(null);
    setOrgless(false);
    clearApexSourceCache();
    lastLogId.current = null;
  }, []);

  /** Drop the parsed-log cache (used on list refresh). */
  const clearViewCache = useCallback(() => {
    viewCache.current.clear();
  }, []);

  /** Fetch the raw-line indices that resolve to Apex source for the given log
   * body, so the raw viewer can mark only those lines clickable. */
  const loadSourceLines = useCallback((raw: string) => {
    sourceLineIndices(raw)
      .then((idx) => setSourceLines(new Set(idx)))
      .catch(() => setSourceLines(new Set()));
  }, []);

  const select = useCallback(async (id: string) => {
    // Switching to a different log: drop the previous log's Apex source cache.
    if (lastLogId.current !== id) {
      clearApexSourceCache();
      lastLogId.current = id;
    }
    setSelectedId(id);
    setOrgless(false);
    setViewError(null);
    setTab("raw");
    const cached = viewCache.current.get(id);
    if (cached) {
      setView(cached);
      loadSourceLines(cached.raw);
      setViewLoading(false);
      return;
    }
    setView(null);
    setSourceLines(new Set());
    setViewLoading(true);
    try {
      // Cache-first (logs are immutable): parse a locally cached body, else
      // download from the org and write it to cache for next time.
      const dto = await fetchLogView(id, org);
      viewCache.current.set(id, dto);
      setView(dto);
      loadSourceLines(dto.raw);
      // loadLogView writes the body to disk on a download; reflect that marker.
      setCachedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    } catch (e) {
      setViewError(formatIpcError(e));
    } finally {
      setViewLoading(false);
    }
  }, [loadSourceLines, org]);

  /** Show a local log body (drag-dropped), parsed but never sent to an org.
   * Unlike `select`, this skips `loadSourceLines` — a dragged file has no
   * reliable org, so raw click-to-source and hotspot/timeline source jumps
   * stay disabled for it (see `orgless`). */
  const showLocalLog = useCallback(async (body: string) => {
    setSelectedId(null);
    // A freshly opened local log: start with an empty Apex source cache.
    clearApexSourceCache();
    lastLogId.current = null;
    setOrgless(true);
    setViewLoading(true);
    setViewError(null);
    setView(null);
    setSourceLines(new Set());
    setTab("raw");
    try {
      setView(await parseLogView(body));
    } catch (e) {
      setViewError(formatIpcError(e));
    } finally {
      setViewLoading(false);
    }
  }, []);

  /** Resolve `log`'s raw body via the same cache-first/org-download path as
   * `select`, without disturbing the currently viewed log. */
  const getBody = useCallback(async (log: LogRefDto): Promise<string> => {
    const cached = viewCache.current.get(log.id);
    if (cached) return cached.raw;
    const dto = await fetchLogView(log.id, org);
    viewCache.current.set(log.id, dto);
    setCachedIds((prev) => (prev.has(log.id) ? prev : new Set(prev).add(log.id)));
    return dto.raw;
  }, [org]);

  return {
    selectedId,
    view,
    viewError,
    viewLoading,
    sourceLines,
    tab,
    setTab,
    orgless,
    sourceRef,
    setSourceRef,
    cachedIds,
    select,
    showLocalLog,
    getBody,
    resetForOrg,
    clearViewCache,
  };
}
