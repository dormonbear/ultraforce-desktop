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
  useToolingApi: false,
  allRows: false,
  plan: null,
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
    reveal,
    openFile,
    openOrReplace,
    newUntitled,
    save,
    close,
    select,
    patch,
    retitle,
    closeByPath,
  } = useFileTabs<SoqlTab>({ tool: "soql", contentKey: "query", make: makeSoqlTab });

  // Stable across content edits (only changes on tab switch) so the editor does
  // not re-render on every keystroke.
  const onSave = useCallback(() => {
    if (active) void save(active.id);
  }, [save, active?.id]);

  // History "open in tab" stages text via openTab; write it to scratch.soql.
  useEffect(() => {
    if (!root) return;
    const tryOpen = () => {
      const text = consumePending("soql");
      if (text != null) void openOrReplace(joinPath(root, "scratch.soql"), text);
    };
    tryOpen();
    return onOpenTabRequest((tool) => {
      if (tool === "soql") tryOpen();
    });
  }, [root, openOrReplace]);

  const activeReveal =
    reveal && active && reveal.id === active.id
      ? { line: reveal.line, nonce: reveal.nonce }
      : undefined;

  const onPatch = useCallback(
    (partial: Partial<SoqlTab>) => {
      if (activeId) patch(activeId, partial);
    },
    [patch, activeId],
  );

  const layout = useDefaultLayout({
    id: "uf-soql-sidebar",
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
            ext="soql"
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
                ariaLabel="SOQL tabs"
                onSelect={select}
                onClose={close}
                onAdd={newUntitled}
              />
              <div role="tabpanel" className="min-h-0 flex-1">
                <SoqlView
                  key={active.id}
                  tab={active}
                  onPatch={onPatch}
                  onSave={onSave}
                  reveal={activeReveal}
                />
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
              — open a query from the sidebar —
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
