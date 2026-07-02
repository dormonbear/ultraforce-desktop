import { useCallback, useEffect, useState } from "react";
import { formatIpcError } from "../errorFormat";
import { loadCachedList, saveCachedList } from "./logCache";
import { listLogs } from "../ipc/logs";
import { filterLogs, EMPTY_FILTER, type LogFilter } from "./logList";
import type { LogRefDto } from "../types";

/** Log list state: load/refresh from the org, persisted-list warm start on org
 * change, and the operation/user text filter.
 *
 * `onOrgChange` runs before the list reloads for a new org (drop selection);
 * `onRefresh` runs at the start of every refresh (drop the parsed-log cache).
 * Both must be referentially stable (useCallback). */
export function useLogList(
  org: string | null,
  onOrgChange: () => void,
  onRefresh: () => void,
) {
  const [logs, setLogs] = useState<LogRefDto[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [filter, setFilter] = useState<LogFilter>(EMPTY_FILTER);
  const visibleLogs = filterLogs(logs, filter);

  const refresh = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    onRefresh();
    try {
      const rows = await listLogs();
      setLogs(rows);
      void saveCachedList(org ?? "default", rows);
    } catch (e) {
      setListError(formatIpcError(e));
    } finally {
      setListLoading(false);
    }
  }, [org, onRefresh]);

  // On org change (and mount): show the persisted list head immediately so
  // reopening the app needs no download, then refresh from the org in the
  // background. Drops any selection from the previous org.
  useEffect(() => {
    onOrgChange();
    let alive = true;
    void loadCachedList(org ?? "default").then((rows) => {
      // Don't clobber a fresh background refresh with an empty/stale cache.
      if (alive && rows.length) setLogs(rows);
    });
    void refresh();
    return () => {
      alive = false;
    };
  }, [refresh, org, onOrgChange]);

  return { logs, visibleLogs, listError, listLoading, filter, setFilter, refresh };
}
