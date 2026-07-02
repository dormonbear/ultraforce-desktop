import { formatIpcError } from "./errorFormat";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { getJson, setJson } from "./store";
import { getNamespacePolicy } from "./indexSettings";
import type { OrgDto } from "./types";

/** Fire-and-forget index/delta-sync for `org`, scoped by the saved namespace policy. */
function triggerIndex(org: string) {
  // Cheap, immediate sObject-name cache for FROM completion. Kept separate from
  // index_org below, which only populates that cache as its final step — after a
  // heavy Apex index that can fail/stall on large orgs, leaving FROM empty.
  void invoke("warm_schema", { org }).catch(() => {});
  void getNamespacePolicy().then((namespaces) =>
    invoke("index_org", { org, namespaces }).catch(() => {}),
  );
}

/** Store key for the last selected org username. */
const ORG_KEY = "settings.org";

interface OrgState {
  orgs: OrgDto[];
  selected: string | null;
  loading: boolean;
  error: string | null;
  /** Set the target org for all subsequent `sf` calls. */
  select: (username: string) => void;
  /** Re-fetch the org list (e.g. after the user logs in from the setup page). */
  reload: () => void;
}

const OrgCtx = createContext<OrgState>({
  orgs: [],
  selected: null,
  loading: true,
  error: null,
  select: () => {},
  reload: () => {},
});

/** Single source of truth for the org list + active org (shared by the top-bar
 * picker and the ⌘K palette, so they never double-fetch or drift out of sync). */
export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgs, setOrgs] = useState<OrgDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const select = useCallback((username: string) => {
    setSelected(username);
    void setJson(ORG_KEY, username);
    invoke("set_target_org", { username }).catch((e) => {
      toast.error(`Failed to switch org: ${formatIpcError(e)}`);
    });
    triggerIndex(username);
  }, []);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      invoke<OrgDto[]>("list_orgs"),
      getJson<string | null>(ORG_KEY, null),
    ])
      .then(([list, savedOrg]) => {
        if (!alive) return;
        setOrgs(list);
        // Prefer the last-selected org (if it still exists), else the CLI default.
        const saved = savedOrg ? list.find((o) => o.username === savedOrg) : undefined;
        const def = saved ?? list.find((o) => o.is_default) ?? list[0];
        if (def) {
          setSelected(def.username);
          void invoke("set_target_org", { username: def.username });
          triggerIndex(def.username);
        }
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
    <OrgCtx.Provider value={{ orgs, selected, loading, error, select, reload }}>
      {children}
    </OrgCtx.Provider>
  );
}

export const useOrgs = () => useContext(OrgCtx);
