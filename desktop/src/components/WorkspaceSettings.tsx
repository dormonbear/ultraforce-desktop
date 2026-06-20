import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getRoot, setRootOverride, type Tool } from "../fs/workspace";
import { Button } from "@/components/ui/button";

interface Props {
  /** Called after a root changes so the owner can remount the affected panel. */
  onChanged: () => void;
}

/** Per-tool workspace root: show current path, pick a new folder, or reset. */
export function WorkspaceSettings({ onChanged }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [roots, setRoots] = useState<Record<Tool, string>>({ soql: "", apex: "" });

  const reload = () =>
    void Promise.all([getRoot("soql"), getRoot("apex")]).then(([soql, apex]) =>
      setRoots({ soql, apex }),
    );
  useEffect(() => {
    if (panelOpen) reload();
  }, [panelOpen]);

  const pick = async (tool: Tool) => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    await setRootOverride(tool, dir);
    reload();
    onChanged();
  };

  const reset = async (tool: Tool) => {
    await setRootOverride(tool, null);
    reload();
    onChanged();
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setPanelOpen((o) => !o)}
        aria-label="Workspace settings"
        className="size-7 cursor-pointer text-text-dim hover:text-foreground"
      >
        <Settings size={15} />
      </Button>
      {panelOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPanelOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-border bg-card p-3 shadow-lg">
            <div className="flex flex-col gap-3 text-[12px]">
              {(["soql", "apex"] as Tool[]).map((tool) => (
                <div key={tool} className="flex flex-col gap-1">
                  <span className="uppercase tracking-wide text-text-dim">
                    {tool} workspace
                  </span>
                  <span
                    className="truncate text-foreground"
                    title={roots[tool]}
                  >
                    {roots[tool] || "…"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void pick(tool)}
                      className="cursor-pointer rounded-md bg-primary/15 px-2 py-0.5 text-primary hover:bg-primary/25"
                    >
                      Change…
                    </button>
                    <button
                      type="button"
                      onClick={() => void reset(tool)}
                      className="cursor-pointer rounded-md px-2 py-0.5 text-text-dim hover:text-foreground"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
