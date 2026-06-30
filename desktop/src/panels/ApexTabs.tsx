import { useCallback, useEffect, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { toast } from "sonner";
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
    newUntitled,
    save,
    close,
    restore,
    select,
    patch,
    retitle,
    closeByPath,
  } = useFileTabs<ApexTab>({ tool: "apex", contentKey: "src", make: makeApexTab });

  // Stable across content edits (only changes on tab switch) so the editor does
  // not re-render on every keystroke.
  const onSave = useCallback(() => {
    if (active) void save(active.id);
  }, [save, active?.id]);

  // Closing an unsaved untitled tab discards its content — offer a quick undo.
  const handleClose = useCallback(
    (id: string) => {
      const t = tabs.find((x) => x.id === id);
      close(id);
      if (t && t.path === "" && t.src.trim() !== "") {
        toast(`Closed ${t.title}`, {
          action: { label: "Undo", onClick: () => restore(t) },
        });
      }
    },
    [tabs, close, restore],
  );

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
      <ResizablePanel
        id="sidebar"
        defaultSize="240px"
        minSize="160px"
        maxSize="420px"
        groupResizeBehavior="preserve-pixel-size"
      >
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
                onClose={handleClose}
                onAdd={newUntitled}
                dirtyIds={tabs
                  .filter((t) => t.path === "" && t.src.trim() !== "")
                  .map((t) => t.id)}
              />
              <div role="tabpanel" className="min-h-0 flex-1">
                <ApexView
                  key={active.id}
                  tab={active}
                  onPatch={onPatch}
                  onSave={onSave}
                  reveal={activeReveal}
                />
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground">
              <span>— open a script from the sidebar —</span>
              <button
                type="button"
                onClick={newUntitled}
                className="focus-accent cursor-pointer rounded-md border border-border px-3 py-1 text-[12px] text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                New script
              </button>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
