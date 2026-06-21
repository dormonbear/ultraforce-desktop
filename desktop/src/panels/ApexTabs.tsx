import { useCallback, useEffect, useState } from "react";
import { TabStrip } from "../tabs/TabStrip";
import { useFileTabs } from "../tabs/useFileTabs";
import { Explorer } from "../components/Explorer";
import { getRoot } from "../fs/workspace";
import { basename } from "../fs/paths";
import { ApexView } from "./ApexPanel";
import type { ApexTab } from "../tabs/types";

const makeApexTab = (path: string, content: string): ApexTab => ({
  id: crypto.randomUUID(),
  path,
  title: basename(path),
  src: content,
  outcome: null,
  error: null,
  traceOpen: false,
});

export function ApexTabs() {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    void getRoot("apex").then(setRoot);
  }, []);

  const {
    tabs,
    active,
    activeId,
    reveal,
    openFile,
    close,
    select,
    patch,
    retitle,
    closeByPath,
  } = useFileTabs<ApexTab>({ tool: "apex", contentKey: "src", make: makeApexTab });

  const activeReveal =
    reveal && active && reveal.id === active.id
      ? { line: reveal.line, nonce: reveal.nonce }
      : undefined;

  const onPatch = useCallback(
    (partial: Partial<ApexTab>) => {
      if (activeId) patch(activeId, partial);
    },
    [patch, activeId],
  );

  return (
    <div className="flex h-full">
      {root && (
        <Explorer
          root={root}
          ext="apex"
          activePath={active?.path ?? null}
          onOpen={(p, line) => void openFile(p, line)}
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
              ariaLabel="Apex tabs"
              onSelect={select}
              onClose={close}
              onAdd={() => {}}
            />
            <div role="tabpanel" className="min-h-0 flex-1">
              <ApexView
                key={active.id}
                tab={active}
                onPatch={onPatch}
                reveal={activeReveal}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
            — open a script from the sidebar —
          </div>
        )}
      </div>
    </div>
  );
}
