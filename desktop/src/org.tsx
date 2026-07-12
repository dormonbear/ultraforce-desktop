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
import { ensureReady } from "./ipc/schema";
import { setActiveOrg } from "./editor/activeOrg";
import type { OrgDto } from "./types";

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
  /** Set the target org for all subsequent `sf` calls. Resolves once the switch
   * is committed; rejects/aborts (selection unchanged) if the backend fails. */
  select: (username: string) => Promise<void>;
  /** Re-fetch the org list (e.g. after the user logs in from the setup page). */
  reload: () => void;
}

const OrgCtx = createContext<OrgState>({
  orgs: [],
  selected: null,
  loading: true,
  error: null,
  select: () => Promise.resolve(),
  reload: () => {},
});

/** Single source of truth for the org list + active org (shared by the top-bar
 * picker and the ⌘K palette, so they never double-fetch or drift out of sync). */
export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgs, setOrgs] = useState<OrgDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const select = useCallback(async (username: string) => {
    // Commit the backend target org first; only reflect the switch in React (and
    // kick off indexing) once it succeeds, so a failed switch never leaves the UI
    // pointing at an org the backend didn't adopt.
    try {
      await setTargetOrg(username);
    } catch (e) {
      toast.error(`Failed to switch org: ${formatIpcError(e)}`);
      return;
    }
    setSelected(username);
    void setJson(ORG_KEY, username);
    triggerIndex(username);
  }, []);

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
    <OrgCtx.Provider value={{ orgs, selected, loading, error, select, reload }}>
      {children}
    </OrgCtx.Provider>
  );
}

export const useOrgs = () => useContext(OrgCtx);
