import { formatIpcError } from "./errorFormat";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { getJson, setJson } from "./store";
import { getNamespacePolicy } from "./indexSettings";
import { listOrgs, setTargetOrg } from "./ipc/org";
import { ensureReady, reindexOrg } from "./ipc/schema";
import { getOrgConfig, setOrgConfig } from "./orgConfig";
import { setActiveOrg } from "./editor/activeOrg";
import type { OrgConfig, OrgDto } from "./types";

/** Fire-and-forget "make this org's index usable", scoped by the saved namespace
 * policy. The backend coordinator is single-flight per org and no-ops when fresh,
 * so calling this from startup, org-switch, and the 5-min poll can't overlap or
 * duplicate work (it also folds in the former separate sObject-name warm-up). */
function triggerIndex(org: string) {
  void getNamespacePolicy().then((namespaces) =>
    ensureReady(org, namespaces).catch(() => {}),
  );
}

/** Store key for the last selected org username. */
const ORG_KEY = "settings.org";

interface OrgState {
  orgs: OrgDto[];
  selected: string | null;
  loading: boolean;
  error: string | null;
  /** Per-org display + behavior config, keyed by username (alias/color/etc). */
  configs: Record<string, OrgConfig>;
  /** Set the target org for all subsequent `sf` calls. Resolves to `true` once the
   * switch is committed; `false` (selection unchanged, toast shown) on failure. */
  select: (username: string) => Promise<boolean>;
  /** Persist one org's config, refresh the backend bounds, and (for the active
   * org, when apiVersion changed) force a reindex. */
  saveConfig: (username: string, config: OrgConfig) => Promise<void>;
  /** Re-fetch the org list (e.g. after the user logs in from the setup page). */
  reload: () => void;
}

const OrgCtx = createContext<OrgState>({
  orgs: [],
  selected: null,
  loading: true,
  error: null,
  configs: {},
  select: () => Promise.resolve(false),
  saveConfig: () => Promise.resolve(),
  reload: () => {},
});

/** Single source of truth for the org list + active org (shared by the top-bar
 * picker and the ⌘K palette, so they never double-fetch or drift out of sync). */
export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgs, setOrgs] = useState<OrgDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, OrgConfig>>({});

  const select = useCallback(async (username: string): Promise<boolean> => {
    // Commit the backend target org first; only reflect the switch in React (and
    // kick off indexing) once it succeeds, so a failed switch never leaves the UI
    // pointing at an org the backend didn't adopt.
    try {
      await setTargetOrg(username);
    } catch (e) {
      toast.error(`Failed to switch org: ${formatIpcError(e)}`);
      return false;
    }
    setSelected(username);
    void setJson(ORG_KEY, username);
    triggerIndex(username);
    return true;
  }, []);

  const saveConfig = useCallback(
    async (username: string, next: OrgConfig) => {
      const prev = configs[username] ?? {};
      await setOrgConfig(username, next);
      setConfigs((c) => ({ ...c, [username]: next }));
      if (username !== selected) return;
      // Re-apply the backend bounds (override + timeout) for every code path, not
      // just indexing, by re-committing the target org (reads the fresh store).
      try {
        await setTargetOrg(username);
      } catch (e) {
        toast.error(`Failed to apply org config: ${formatIpcError(e)}`);
        return;
      }
      // A changed apiVersion invalidates the cached index — force a rebuild
      // (reindex bypasses the coordinator's freshness TTL, unlike ensureReady).
      if ((prev.apiVersion ?? "") !== (next.apiVersion ?? "")) {
        void getNamespacePolicy().then((namespaces) =>
          reindexOrg(username, namespaces).catch(() => {}),
        );
      }
    },
    [configs, selected],
  );

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Mirror the active org for Monaco language providers, which live outside the
  // React tree and can't read this context (see editor/activeOrg.ts).
  useEffect(() => {
    setActiveOrg(selected);
  }, [selected]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      listOrgs(),
      getJson<string | null>(ORG_KEY, null),
    ])
      .then(async ([list, savedOrg]) => {
        if (!alive) return;
        setOrgs(list);
        // Load each org's persisted config (alias/color for the badge + switcher).
        void Promise.all(
          list.map(async (o) => [o.username, await getOrgConfig(o.username)] as const),
        ).then((entries) => {
          if (alive) setConfigs(Object.fromEntries(entries));
        });
        // Prefer the last-selected org (if it still exists), else the CLI default.
        const saved = savedOrg ? list.find((o) => o.username === savedOrg) : undefined;
        const def = saved ?? list.find((o) => o.isDefault) ?? list[0];
        if (!def) return;
        // Same commit-then-reflect ordering as `select`: adopt the target org in
        // the backend before marking it selected / triggering the index.
        try {
          await setTargetOrg(def.username);
        } catch (e) {
          if (alive) {
            const message = formatIpcError(e);
            setError(message);
            toast.error(message);
          }
          return;
        }
        if (!alive) return;
        setSelected(def.username);
        triggerIndex(def.username);
      })
      .catch((e) => {
        if (!alive) return;
        const message = formatIpcError(e);
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Background delta-sync: while an org is selected, poll for schema/class
  // changes. `index_org` on an existing snapshot only delta-syncs and emits a
  // sync-result toast when something changed (no progress bar).
  // ponytail: fixed 5-min poll; make configurable if users ask.
  useEffect(() => {
    if (!selected) return;
    const POLL_MS = 5 * 60_000;
    const id = setInterval(() => triggerIndex(selected), POLL_MS);
    return () => clearInterval(id);
  }, [selected]);

  return (
    <OrgCtx.Provider
      value={{ orgs, selected, loading, error, configs, select, saveConfig, reload }}
    >
      {children}
    </OrgCtx.Provider>
  );
}

export const useOrgs = () => useContext(OrgCtx);
