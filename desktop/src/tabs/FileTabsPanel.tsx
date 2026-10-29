import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { toast } from "sonner";
import { TabStrip } from "./TabStrip";
import { useFileTabs } from "./useFileTabs";
import { useSidebarSync } from "../panels/useSidebarSync";
import { Explorer } from "../components/Explorer";
import { getRoot, type Tool } from "../fs/workspace";
import { renameNode } from "../fs/tree";
import { formatIpcError } from "../errorFormat";
import { renameIntent } from "./nameEdit";
import { normalizePath } from "../fs/paths";
import { useEditorFocusIntent } from "../editor/focus-intent";
import type { Reveal } from "../editor/monaco-reveal";
import type { TabBase } from "./types";

interface ViewArgs<T> {
  tab: T;
  onPatch: (partial: Partial<T>) => void;
  onSave: () => void;
  reveal?: Reveal;
  shouldFocusEditor: () => boolean;
}

interface FileTabsPanelProps<T extends TabBase & { path: string }> {
  tool: Tool;
  ext: Tool;
  /** The tab field holding editor content ("query" | "src"), used for dirty checks. */
  contentKey: keyof T;
  make: (path: string, content: string) => T;
  ariaLabel: string;
  /** Placeholder shown when no tab is open. */
  emptyHint: string;
  /** Label for the "new tab" button in the empty state. */
  newLabel: string;
  renderView: (args: ViewArgs<T>) => ReactNode;
}

/**
 * Shared file-tabs panel: sidebar Explorer + tab strip + a tool-specific editor
 * view. SOQL and Apex differ only in their tab shape, content field, and view,
 * which are passed in — so the layout, tab lifecycle, and sidebar sync live here
 * once.
 */
// fallow-ignore-next-line complexity
export function FileTabsPanel<T extends TabBase & { path: string }>({
  tool,
  ext,
  contentKey,
  make,
  ariaLabel,
  emptyHint,
  newLabel,
  renderView,
}: FileTabsPanelProps<T>) {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    void getRoot(tool).then(setRoot);
  }, [tool]);
  // Bumped after a tab-strip rename so the Explorer tree re-reads from disk
  // (it otherwise only refreshes on mount / window focus / its own edits).
  const [treeRefresh, setTreeRefresh] = useState(0);
  const { capture: captureFocus, allows: allowsFocus } = useEditorFocusIntent();

  const {
    tabs,
    active,
    activeId,
    reveal,
    openFile,
    newUntitled,
    save,
    close,
    restore,
    select,
    patch,
    retitle,
    closeByPath,
  } = useFileTabs<T>({ tool, contentKey, make });

  const isDirtyUntitled = (t: T) =>
    t.path === "" && String(t[contentKey] ?? "").trim() !== "";

  // Stable across content edits (only changes on tab switch) so the editor does
  // not re-render on every keystroke.
  const onSave = useCallback(() => {
    if (active)
      void save(active.id).catch((error: unknown) => {
        toast.error(formatIpcError(error));
      });
  }, [save, active?.id]);

  // Closing an unsaved untitled tab discards its content — offer a quick undo.
  const handleClose = useCallback(
    (id: string) => {
      const t = tabs.find((x) => x.id === id);
      captureFocus();
      close(id);
      if (t && isDirtyUntitled(t)) {
        toast(`Closed ${t.title}`, {
          action: { label: "Undo", onClick: () => { captureFocus({ id: t.id }); restore(t); } },
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, close, restore, captureFocus],
  );

  const addTab = () => {
    const id = newUntitled();
    captureFocus({ id });
  };

  const activeReveal =
    reveal && active && reveal.id === active.id
      ? { line: reveal.line, nonce: reveal.nonce }
      : undefined;

  const onPatch = useCallback(
    (partial: Partial<T>) => {
      if (activeId) patch(activeId, partial);
    },
    [patch, activeId],
  );

  // Rename the backing file (reuses the Explorer rename IPC + validation).
  const renameOnDisk = useCallback(
    async (from: string, to: string): Promise<boolean> => {
      try {
        await renameNode(from, to, retitle);
        setTreeRefresh((n) => n + 1);
        return true;
      } catch (err) {
        toast.error(formatIpcError(err));
        return false;
      }
    },
    [retitle],
  );

  // Commit a tab rename. Returns false to keep the inline editor open (empty or
  // failed rename), true to close it.
  const onRenameTab = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const t = tabs.find((x) => x.id === id);
      if (!t) return true;
      const intent = renameIntent(name, t.title, t.path);
      if (intent.kind === "done") return intent.ok;
      if (intent.kind === "title") {
        patch(id, { title: intent.name, renamed: true } as Partial<T>);
        return true;
      }
      return renameOnDisk(t.path, intent.name);
    },
    [tabs, patch, renameOnDisk],
  );

  const layout = useSidebarSync();

  return (
    <ResizablePanelGroup
      direction="horizontal"
      groupRef={layout.groupRef}
      elementRef={layout.elementRef}
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className="h-full"
    >
      <ResizablePanel
        id="sidebar"
        defaultSize="240px"
        minSize="224px"
        maxSize="420px"
        groupResizeBehavior="preserve-pixel-size"
      >
        {root && (
          <Explorer
            root={root}
            ext={ext}
            activePath={active?.path ?? null}
            onOpen={(p, line) => {
              captureFocus({ path: normalizePath(p) });
              void openFile(p, line).catch((error: unknown) => {
                toast.error(formatIpcError(error));
              });
            }}
            onRenamed={retitle}
            onRemoved={closeByPath}
            refreshToken={treeRefresh}
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
                ariaLabel={ariaLabel}
                onSelect={(id) => { captureFocus({ id }); select(id); }}
                onClose={handleClose}
                onRename={onRenameTab}
                onAdd={addTab}
                dirtyIds={tabs.filter(isDirtyUntitled).map((t) => t.id)}
              />
              <div role="tabpanel" className="min-h-0 flex-1">
                {renderView({
                  tab: active,
                  onPatch,
                  onSave,
                  reveal: activeReveal,
                  shouldFocusEditor: () => allowsFocus(active.id, active.path),
                })}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground">
              <span>{emptyHint}</span>
              <button
                type="button"
                onClick={addTab}
                className="focus-accent cursor-pointer rounded-md border border-border px-3 py-1 text-[12px] text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {newLabel}
              </button>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
