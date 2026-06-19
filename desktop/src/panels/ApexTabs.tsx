import { useCallback } from "react";
import { TabStrip } from "../tabs/TabStrip";
import { useTabs } from "../tabs/useTabs";
import { ApexView } from "./ApexPanel";
import type { ApexTab } from "../tabs/types";

const DEFAULT_SRC = "System.debug('hello');";

const makeApexTab = (n: number): ApexTab => ({
  id: crypto.randomUUID(),
  title: `Anonymous Apex ${n}`,
  src: DEFAULT_SRC,
  outcome: null,
  error: null,
  traceOpen: false,
});

export function ApexTabs() {
  const { tabs, active, activeId, add, close, select, patch } =
    useTabs<ApexTab>(makeApexTab);

  const onPatch = useCallback(
    (partial: Partial<ApexTab>) => patch(activeId, partial),
    [patch, activeId],
  );

  return (
    <div className="flex h-full flex-col">
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        ariaLabel="Apex tabs"
        onSelect={select}
        onClose={close}
        onAdd={add}
      />
      <div
        role="tabpanel"
        aria-labelledby={`tab-${active.id}`}
        className="min-h-0 flex-1"
      >
        <ApexView key={active.id} tab={active} onPatch={onPatch} />
      </div>
    </div>
  );
}
