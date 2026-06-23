import { useCallback, useEffect, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TabStrip } from "../tabs/TabStrip";
import { useFileTabs } from "../tabs/useFileTabs";
import { Explorer } from "../components/Explorer";
import { getRoot } from "../fs/workspace";
import { basename, joinPath } from "../fs/paths";
import { consumePending, onOpenTabRequest } from "../openTab";
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
    openOrReplace,
    close,
    select,
    patch,
    retitle,
    closeByPath,
  } = useFileTabs<ApexTab>({ tool: "apex", contentKey: "src", make: makeApexTab });

  // History "open in tab" stages text via openTab; write it to scratch.apex.
  useEffect(() => {
    if (!root) return;
    const tryOpen = () => {
      const text = consumePending("apex");
      if (text != null) void openOrReplace(joinPath(root, "scratch.apex"), text);
    };
    tryOpen();
    return onOpenTabRequest((tool) => {
      if (tool === "apex") tryOpen();
    });
  }, [root, openOrReplace]);

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

  const layout = useDefaultLayout({
    id: "uf-apex-sidebar",
    panelIds: ["sidebar", "main"],
    storage: localStorage,
  });

  return (
    <ResizablePanelGroup
      direction="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className="h-full"
    >
      <ResizablePanel id="sidebar" defaultSize="240px" minSize="160px" maxSize="420px">
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
      </ResizablePanel>
      <ResizableHandle className="w-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />
      <ResizablePanel id="main" minSize="320px">
        <div className="flex h-full min-w-0 flex-col">
          {active ? (
            <>
              <TabStrip
                tabs={tabs}
                activeId={activeId ?? ""}
                ariaLabel="Apex tabs"
                onSelect={select}
                onClose={close}
                onAdd={() => {
                  if (!root) return;
                  const n =
                    tabs.filter((t) => /untitled-\d+\.apex$/.test(t.path))
                      .length + 1;
                  void openOrReplace(joinPath(root, `untitled-${n}.apex`), "");
                }}
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
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
