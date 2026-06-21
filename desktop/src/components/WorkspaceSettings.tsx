import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { getRoot, setRootOverride, type Tool } from "../fs/workspace";
import { getNamespacePolicy, setNamespacePolicy } from "../indexSettings";
import { useOrgs } from "../org";
import { Button } from "@/components/ui/button";

interface Props {
  /** Called after a root changes so the owner can remount the affected panel. */
  onChanged: () => void;
}

/** Per-tool workspace root: show current path, pick a new folder, or reset. */
export function WorkspaceSettings({ onChanged }: Props) {
  const { selected: org } = useOrgs();
  const [panelOpen, setPanelOpen] = useState(false);
  const [roots, setRoots] = useState<Record<Tool, string>>({ soql: "", apex: "" });
  const [ns, setNs] = useState<string>("all");

  const reload = () => {
    void Promise.all([getRoot("soql"), getRoot("apex")]).then(([soql, apex]) =>
      setRoots({ soql, apex }),
    );
    void getNamespacePolicy().then(setNs);
  };
  useEffect(() => {
    if (panelOpen) reload();
  }, [panelOpen]);

  // Change the index namespace scope and reindex the active org so it takes effect.
  const changeNs = async (value: string) => {
    setNs(value);
    await setNamespacePolicy(value);
    if (org) {
      await invoke("reindex_org", { org, namespaces: value }).catch((e) =>
        toast.error(`Reindex failed: ${typeof e === "string" ? e : String(e)}`),
      );
      toast.success("Reindexing org…");
    }
  };

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
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <span className="uppercase tracking-wide text-text-dim">
                  index scope
                </span>
                <select
                  value={ns}
                  onChange={(e) => void changeNs(e.target.value)}
                  className="cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-foreground"
                  aria-label="Index namespace scope"
                >
                  <option value="all">All objects</option>
                  <option value="unmanaged">Unmanaged only (skip managed packages)</option>
                </select>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
