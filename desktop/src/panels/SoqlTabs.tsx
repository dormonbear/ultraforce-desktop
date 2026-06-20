import { useCallback, useEffect, useState } from "react";
import { TabStrip } from "../tabs/TabStrip";
import { useFileTabs } from "../tabs/useFileTabs";
import { Explorer } from "../components/Explorer";
import { getRoot } from "../fs/workspace";
import { basename } from "../fs/paths";
import { SoqlView } from "./SoqlPanel";
import type { SoqlTab } from "../tabs/types";

const makeSoqlTab = (path: string, content: string): SoqlTab => ({
  id: crypto.randomUUID(),
  path,
  title: basename(path),
  query: content,
  result: null,
  error: null,
  view: "table",
});

export function SoqlTabs() {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    void getRoot("soql").then(setRoot);
  }, []);

  const {
    tabs,
    active,
    activeId,
    openFile,
    close,
    select,
    patch,
    retitle,
    closeByPath,
  } = useFileTabs<SoqlTab>({ tool: "soql", contentKey: "query", make: makeSoqlTab });

  const onPatch = useCallback(
    (partial: Partial<SoqlTab>) => {
      if (activeId) patch(activeId, partial);
    },
    [patch, activeId],
  );

  return (
    <div className="flex h-full">
      {root && (
        <Explorer
          root={root}
          ext="soql"
          activePath={active?.path ?? null}
          onOpen={(p) => void openFile(p)}
          onRenamed={retitle}
          onRemoved={closeByPath}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <TabStrip
              tabs={tabs}
              activeId={activeId ?? ""}
              ariaLabel="SOQL tabs"
              onSelect={select}
              onClose={close}
              onAdd={() => {}}
            />
            <div role="tabpanel" className="min-h-0 flex-1">
              <SoqlView key={active.id} tab={active} onPatch={onPatch} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
            — open a query from the sidebar —
          </div>
        )}
      </div>
    </div>
  );
}
