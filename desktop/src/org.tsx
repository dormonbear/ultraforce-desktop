import { formatIpcError } from "./errorFormat";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { setJson } from "./store";
import { getNamespacePolicy } from "./indexSettings";
import { setTargetOrg } from "./ipc/org";
import { ensureReady, reindexOrg } from "./ipc/schema";
import { ORG_KEY, useOrgList } from "./orgList";
import { setOrgConfig } from "./orgConfig";
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
 * picker and the ⌘K palette, so they never double-fetch or drift out of sync).
 * The list itself lives in `useOrgList`; this owns the selection. */
export function OrgProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);

  // Mirror the active org for Monaco language providers, which live outside the
  // React tree and can't read this context (see editor/activeOrg.ts), and for
  // the refresh path, which must not close over a stale `selected`.
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
    setActiveOrg(selected);
  }, [selected]);

  /** Commit-then-reflect: adopt the org in the backend before marking it
   * selected, so a failed switch never leaves the UI pointing at an org the
   * backend didn't adopt. The ref is set here rather than left to the effect
   * above, since `refresh` reads it as soon as this resolves and a state update
   * that hasn't rendered yet would look like "nothing selected". */
  const commit = useCallback(async (username: string) => {
    await setTargetOrg(username);
    selectedRef.current = username;
    setSelected(username);
    triggerIndex(username);
  }, []);

  const adopt = useCallback(
    async (username: string) => {
      try {
        await commit(username);
      } catch (e) {
        toast.error(formatIpcError(e));
      }
    },
    [commit],
  );

  const select = useCallback(
    async (username: string): Promise<boolean> => {
      try {
        await commit(username);
      } catch (e) {
        toast.error(`Failed to switch org: ${formatIpcError(e)}`);
        return false;
      }
      void setJson(ORG_KEY, username);
      return true;
    },
    [commit],
  );

  /** Authorization expired, or the org was logged out from the CLI. Never
   * auto-pick a replacement: silently moving the selection could run the next
   * SOQL / anonymous Apex against an org you didn't intend (prod). Clear the
   * persisted pick and the backend target too — leaving them would just move the
   * silent switch to the next launch, where the dead org no longer matches and
   * the fallback lands on some other org. */
  const onOrgGone = useCallback((username: string) => {
    selectedRef.current = null;
    setSelected(null);
    void setJson(ORG_KEY, null);
    void setTargetOrg(null).catch(() => {});
    toast.error(`Org ${username} is no longer available — pick another one.`);
  }, []);

  const { orgs, loading, error, configs, setConfigs, reload } = useOrgList({
    selectedRef,
    adopt,
    onOrgGone,
  });

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
    [configs, selected, setConfigs],
  );

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
