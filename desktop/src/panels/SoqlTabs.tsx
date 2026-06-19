import { useCallback } from "react";
import { TabStrip } from "../tabs/TabStrip";
import { useTabs } from "../tabs/useTabs";
import { SoqlView } from "./SoqlPanel";
import type { SoqlTab } from "../tabs/types";

const DEFAULT_QUERY = "SELECT Id, Name FROM Account LIMIT 10";

const makeSoqlTab = (n: number): SoqlTab => ({
  id: crypto.randomUUID(),
  title: `SOQL Query ${n}`,
  query: DEFAULT_QUERY,
  result: null,
  error: null,
  view: "table",
});

export function SoqlTabs() {
  const { tabs, active, activeId, add, close, select, patch } =
    useTabs<SoqlTab>(makeSoqlTab);

  const onPatch = useCallback(
    (partial: Partial<SoqlTab>) => patch(activeId, partial),
    [patch, activeId],
  );

  return (
    <div className="flex h-full flex-col">
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        ariaLabel="SOQL tabs"
        onSelect={select}
        onClose={close}
        onAdd={add}
      />
      <div
        role="tabpanel"
        aria-labelledby={`tab-${active.id}`}
        className="min-h-0 flex-1"
      >
        <SoqlView key={active.id} tab={active} onPatch={onPatch} />
      </div>
    </div>
  );
}
