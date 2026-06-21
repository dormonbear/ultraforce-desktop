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
import type { OrgDto } from "./types";

/** Store key for the last selected org username. */
const ORG_KEY = "settings.org";

interface OrgState {
  orgs: OrgDto[];
  selected: string | null;
  loading: boolean;
  error: string | null;
  /** Set the target org for all subsequent `sf` calls. */
  select: (username: string) => void;
}

const OrgCtx = createContext<OrgState>({
  orgs: [],
  selected: null,
  loading: true,
  error: null,
  select: () => {},
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
      toast.error(`Failed to switch org: ${typeof e === "string" ? e : String(e)}`);
    });
    void invoke("index_org", { org: username }).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
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
          void invoke("index_org", { org: def.username }).catch(() => {});
        }
      })
      .catch((e) => {
        if (!alive) return;
        const message = typeof e === "string" ? e : String(e);
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Background delta-sync: while an org is selected, poll for schema/class
  // changes. `index_org` on an existing snapshot only delta-syncs and emits a
  // sync-result toast when something changed (no progress bar).
  // ponytail: fixed 5-min poll; make configurable if users ask.
  useEffect(() => {
    if (!selected) return;
    const POLL_MS = 5 * 60_000;
    const id = setInterval(() => {
      void invoke("index_org", { org: selected }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [selected]);

  return (
    <OrgCtx.Provider value={{ orgs, selected, loading, error, select }}>
      {children}
    </OrgCtx.Provider>
  );
}

export const useOrgs = () => useContext(OrgCtx);
