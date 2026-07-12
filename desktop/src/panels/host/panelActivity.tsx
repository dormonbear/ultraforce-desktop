import { createContext, useContext, useMemo, type ReactNode } from "react";

/** Whether the panel this subtree belongs to is the foreground (visible) tool.
 * Descendants read it via `usePanelActivity()` to pause hidden-panel work
 * (Logs' countdown tick) or to react to becoming visible (schema virtualizers
 * re-measure on show). */
export interface PanelActivity {
  active: boolean;
}

// Default `active: true` so a panel rendered outside a PanelHost (unit tests,
// standalone) behaves as if it were the visible one.
const PanelActivityContext = createContext<PanelActivity>({ active: true });

/** Provide a single panel's activity to its subtree. Memoized per panel so a
 * switch only re-renders the two panels whose `active` actually flips — a fresh
 * value object on every host render would defeat the panels' `React.memo`. */
export function PanelActivityProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ active }), [active]);
  return (
    <PanelActivityContext.Provider value={value}>
      {children}
    </PanelActivityContext.Provider>
  );
}

export const usePanelActivity = (): PanelActivity =>
  useContext(PanelActivityContext);
