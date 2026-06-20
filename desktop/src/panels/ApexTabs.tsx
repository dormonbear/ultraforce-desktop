import { useCallback, useEffect } from "react";
import { TabStrip } from "../tabs/TabStrip";
import { useTabs } from "../tabs/useTabs";
import { consumePending, onOpenTabRequest } from "../openTab";
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
  const { tabs, active, activeId, add, openWith, close, select, patch, rename } =
    useTabs<ApexTab>(makeApexTab, { storeKey: "apex" });

  const onPatch = useCallback(
    (partial: Partial<ApexTab>) => patch(activeId, partial),
    [patch, activeId],
  );

  // Open sources handed over from the history drawer in a fresh tab.
  useEffect(() => {
    const tryOpen = () => {
      const text = consumePending("apex");
      if (text != null) openWith({ src: text });
    };
    tryOpen();
    return onOpenTabRequest(() => tryOpen());
  }, [openWith]);

  return (
    <div className="flex h-full flex-col">
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        ariaLabel="Apex tabs"
        onSelect={select}
        onClose={close}
        onAdd={add}
        onRename={rename}
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
