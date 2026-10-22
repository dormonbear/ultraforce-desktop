import { useCallback, useEffect, useRef, useState } from "react";
import { formatIpcError } from "./errorFormat";
import { loadLoggingConfig } from "./ipc/config";
import type { DebugLevelDto } from "./types";

// Completed presets stay cached per target until refreshed. / 已完成的预设按目标缓存，直到刷新。
const levelsCache = new Map<string, DebugLevelDto[]>();

type PresetState = {
  org: string | null;
  records: DebugLevelDto[];
  loading: boolean;
  error: string | null;
};

/** Owns preset requests for the active org/view. / 管理活动组织／视图的预设请求。 */
export function useDebugPresets(org: string | null, open: boolean) {
  const [state, setState] = useState<PresetState>({ org, records: [], loading: false, error: null });
  const generation = useRef(0);
  const load = useCallback(async (force: boolean) => {
    const request = ++generation.current;
    const cacheKey = org ?? "";
    const cached = force ? undefined : levelsCache.get(cacheKey);
    if (cached) {
      setState({ org, records: cached, loading: false, error: null });
      return;
    }
    setState(previous => ({ org, records: previous.org === org ? previous.records : [], loading: true, error: null }));
    try {
      const config = await loadLoggingConfig(org);
      if (generation.current !== request) return;
      levelsCache.set(cacheKey, config.debugLevels);
      setState({ org, records: config.debugLevels, loading: false, error: null });
    } catch (error) {
      if (generation.current !== request) return;
      const message = formatIpcError(error);
      setState(previous => ({ org, records: previous.org === org ? previous.records : [], loading: false, error: message }));
    }
  }, [org]);

  useEffect(() => {
    if (open) void load(false);
    return () => { generation.current++; };
  }, [open, load]);

  return {
    records: state.org === org ? state.records : [],
    loading: open && (state.org === org ? state.loading : true),
    error: state.org === org ? state.error : null,
    refresh: () => { void load(true); },
  };
}
