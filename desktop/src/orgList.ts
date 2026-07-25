import { useCallback, useEffect, useState, type RefObject } from "react";
import { toast } from "sonner";
import { formatIpcError } from "./errorFormat";
import { getJson, setJson } from "./store";
import { listOrgs } from "./ipc/org";
import { onWindowShown } from "./ipc/window";
import { getOrgConfig } from "./orgConfig";
import { markStartup } from "./startup";
import type { OrgConfig, OrgDto } from "./types";

/** Store key for the last selected org username. */
export const ORG_KEY = "settings.org";
/** Last known org list. `sf org list` spawns the Node CLI and checks every org's
 * connection over the network, so cold start used to sit on a splash screen
 * waiting for it — render from this instead and refresh in the background. */
const ORGS_CACHE_KEY = "cache.orgs";

/** Last selected org if it still exists, else the CLI default, else the first. */
function pickDefault(list: OrgDto[], saved: string | null): OrgDto | undefined {
  const savedOrg = saved ? list.find((o) => o.username === saved) : undefined;
  return savedOrg ?? list.find((o) => o.isDefault) ?? list[0];
}

interface Options {
  /** Current selection, read after awaits where React state would be stale. */
  selectedRef: RefObject<string | null>;
  /** Commit an org as the backend target and reflect it in the UI. */
  adopt: (username: string) => Promise<void>;
  /** The selected org vanished from the CLI (deauthed / logged out). */
  onOrgGone: (username: string) => void;
}

/** Owns the org list itself: cache-first hydration, background refresh, and the
 * per-org configs. Selection lives in the provider (see org.tsx) — this only
 * reports a selection that stopped existing. */
export function useOrgList({ selectedRef, adopt, onOrgGone }: Options) {
  const [orgs, setOrgs] = useState<OrgDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, OrgConfig>>({});

  const loadConfigs = useCallback((list: OrgDto[]) => {
    // Each org's persisted config (alias/color for the badge + switcher).
    void Promise.all(
      list.map(async (o) => [o.username, await getOrgConfig(o.username)] as const),
    ).then((entries) => setConfigs(Object.fromEntries(entries)));
  }, []);

  /** Re-read the org list from the CLI and reconcile. Never shows the splash —
   * it clears `loading` for the callers that have nothing on screen yet. */
  const refresh = useCallback(async () => {
    let list: OrgDto[];
    try {
      list = await listOrgs();
    } catch (e) {
      const message = formatIpcError(e);
      setError(message);
      toast.error(message);
      setLoading(false);
      return;
    }
    setOrgs(list);
    setError(null);
    setLoading(false);
    void setJson(ORGS_CACHE_KEY, list);
    loadConfigs(list);
    markStartup("orgs-fresh");
    const current = selectedRef.current;
    if (current && !list.some((o) => o.username === current)) {
      onOrgGone(current);
      return;
    }
    if (current) return;
    const def = pickDefault(list, await getJson<string | null>(ORG_KEY, null));
    if (def) await adopt(def.username);
  }, [adopt, loadConfigs, onOrgGone, selectedRef]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [cached, savedOrg] = await Promise.all([
        getJson<OrgDto[]>(ORGS_CACHE_KEY, []),
        getJson<string | null>(ORG_KEY, null),
      ]);
      if (!alive) return;
      const def = pickDefault(cached, savedOrg);
      if (def) {
        // Paint from cache immediately; `refresh` reconciles a moment later.
        setOrgs(cached);
        loadConfigs(cached);
        await adopt(def.username);
        if (!alive) return;
        setLoading(false);
        markStartup("orgs-cached");
      }
      await refresh();
    })();
    return () => {
      alive = false;
    };
  }, [adopt, loadConfigs, refresh]);

  // Coming back from the menu bar is the moment a `sf org login` done in a
  // terminal should show up — the process may have been resident for days.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    void onWindowShown(() => void refresh()).then((un) => {
      if (alive) stop = un;
      else un();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [refresh]);

  return { orgs, loading, error, configs, setConfigs, reload: refresh };
}
