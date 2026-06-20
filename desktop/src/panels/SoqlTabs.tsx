import { useCallback, useEffect } from "react";
import { TabStrip } from "../tabs/TabStrip";
import { useTabs } from "../tabs/useTabs";
import { consumePending, onOpenTabRequest } from "../openTab";
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

// Keep persisted tabs lean: drop result snapshots above this row count
// (reopening the tab simply reruns the query).
const MAX_PERSISTED_ROWS = 500;
const serializeSoql = (t: SoqlTab): SoqlTab =>
  t.result && t.result.rows.length > MAX_PERSISTED_ROWS
    ? { ...t, result: null }
    : t;

export function SoqlTabs() {
  const { tabs, active, activeId, add, openWith, close, select, patch, rename } =
    useTabs<SoqlTab>(makeSoqlTab, {
      storeKey: "soql",
      serialize: serializeSoql,
    });

  const onPatch = useCallback(
    (partial: Partial<SoqlTab>) => patch(activeId, partial),
    [patch, activeId],
  );

  // Open queries handed over from the history drawer in a fresh tab.
  useEffect(() => {
    const tryOpen = () => {
      const text = consumePending("soql");
      if (text != null) openWith({ query: text });
    };
    tryOpen();
    return onOpenTabRequest(() => tryOpen());
  }, [openWith]);

  return (
    <div className="flex h-full flex-col">
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        ariaLabel="SOQL tabs"
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
        <SoqlView key={active.id} tab={active} onPatch={onPatch} />
      </div>
    </div>
  );
}
