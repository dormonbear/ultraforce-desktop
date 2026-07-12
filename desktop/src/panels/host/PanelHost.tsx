import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSchemaPreheat } from "../../useSchemaPreheat";
import { PanelActivityProvider } from "./panelActivity";

export interface PanelDef {
  id: string;
  render: () => ReactNode;
  /** Idle-preheat this panel (hidden) once the org index is ready — Schema only. */
  preload?: boolean;
}

/**
 * Owns the tool-panel lifecycle in one place: first-visit mounting, keep-alive
 * (a visited panel stays mounted but `hidden` when inactive so its run results
 * survive a switch), and the preload policy. Each panel subtree is wrapped in a
 * `PanelActivityProvider` so descendants can read whether their panel is the
 * visible one via `usePanelActivity()`.
 *
 * The host is the single owner of these rules; App composes it with a panel list
 * and the rail/keyboard shortcuts drive `active`.
 */
export function PanelHost({
  panels,
  active,
  preheatOrg,
  preheatEnabled,
}: {
  panels: PanelDef[];
  active: string;
  preheatOrg: string | null;
  preheatEnabled: boolean;
}) {
  const [visited, setVisited] = useState<string[]>(() =>
    panels.some((p) => p.id === active) ? [active] : [],
  );
  const markVisited = useCallback(
    (id: string) => setVisited((v) => (v.includes(id) ? v : [...v, id])),
    [],
  );
  useEffect(() => {
    if (panels.some((p) => p.id === active)) markVisited(active);
  }, [active, panels, markVisited]);

  // Preload policy: once the selected org's index is ready, idle-pre-mount the
  // (hidden) panel flagged `preload` (only Schema opts in), so the first entry
  // pays only a hidden→visible toggle, not a cold mount + IPC.
  const preloadId = panels.find((p) => p.preload)?.id;
  const preheat = useCallback(() => {
    if (preloadId) markVisited(preloadId);
  }, [preloadId, markVisited]);
  useSchemaPreheat(
    preheatOrg,
    preheatEnabled && preloadId != null && !visited.includes(preloadId),
    preheat,
  );

  return (
    <>
      {panels.map(
        (p) =>
          visited.includes(p.id) && (
            <div key={p.id} className="h-full" hidden={active !== p.id}>
              <PanelActivityProvider active={active === p.id}>
                {p.render()}
              </PanelActivityProvider>
            </div>
          ),
      )}
    </>
  );
}
