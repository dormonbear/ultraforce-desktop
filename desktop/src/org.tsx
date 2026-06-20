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
import type { OrgDto } from "./types";

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
    invoke("set_target_org", { username }).catch((e) => {
      toast.error(`Failed to switch org: ${typeof e === "string" ? e : String(e)}`);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    invoke<OrgDto[]>("list_orgs")
      .then((list) => {
        if (!alive) return;
        setOrgs(list);
        const def = list.find((o) => o.is_default) ?? list[0];
        if (def) {
          setSelected(def.username);
          void invoke("set_target_org", { username: def.username });
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

  return (
    <OrgCtx.Provider value={{ orgs, selected, loading, error, select }}>
      {children}
    </OrgCtx.Provider>
  );
}

export const useOrgs = () => useContext(OrgCtx);
