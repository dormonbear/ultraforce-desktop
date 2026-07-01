import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { getRoot, setRootOverride, type Tool } from "../fs/workspace";
import { getNamespacePolicy, setNamespacePolicy } from "../indexSettings";
import { useOrgs } from "../org";
import { useTheme } from "../theme";
import {
  HIGHLIGHT_SCHEMES,
  schemeColors,
  type HighlightScheme,
} from "../editor-themes";
import { checkForUpdates } from "../updater";
import { Button } from "@/components/ui/button";

interface Props {
  /** Called after a workspace root changes so the owner can remount the panel. */
  onChanged: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="micro-label">{title}</h2>
      <div className="rounded-md border border-border bg-card p-4">{children}</div>
    </section>
  );
}

/** Live sample of the selected highlight scheme, colored from its palette. */
function SchemePreview({ scheme, dark }: { scheme: HighlightScheme; dark: boolean }) {
  const c = schemeColors(scheme, dark);
  return (
    <pre
      className="overflow-x-auto rounded-md border border-border p-3 font-mono text-[11px] leading-relaxed"
      style={{ background: c.bg, color: c.fg }}
    >
      <div style={{ color: c.comment }}>// syntax highlighting preview</div>
      <div>
        <span style={{ color: c.keyword }}>public class</span>{" "}
        <span style={{ color: c.type }}>Demo</span> {"{"}
      </div>
      <div>
        {"  "}
        <span style={{ color: c.type }}>Integer</span> count ={" "}
        <span style={{ color: c.number }}>42</span>;
      </div>
      <div>
        {"  "}
        <span style={{ color: c.type }}>String</span> name ={" "}
        <span style={{ color: c.string }}>'Ultraforce'</span>;
      </div>
      <div>{"}"}</div>
    </pre>
  );
}

/** Full settings center: appearance, per-tool workspace roots, index scope, about. */
export function SettingsPage({ onChanged }: Props) {
  const { selected: org } = useOrgs();
  const { theme, toggle, scheme, setScheme } = useTheme();
  const [roots, setRoots] = useState<Record<Tool, string>>({ soql: "", apex: "" });
  const [ns, setNs] = useState<string>("all");
  const [version, setVersion] = useState("");

  useEffect(() => {
    void Promise.all([getRoot("soql"), getRoot("apex")]).then(([soql, apex]) =>
      setRoots({ soql, apex }),
    );
    void getNamespacePolicy().then(setNs);
    void getVersion().then(setVersion);
  }, []);

  // Change the index namespace scope and reindex the active org so it takes effect.
  const changeNs = async (value: string) => {
    setNs(value);
    await setNamespacePolicy(value);
    if (org) {
      try {
        await invoke("reindex_org", { org, namespaces: value });
        toast.success("Reindexing org…");
      } catch (e) {
        toast.error(`Reindex failed: ${typeof e === "string" ? e : String(e)}`);
      }
    }
  };

  const pick = async (tool: Tool) => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    await setRootOverride(tool, dir);
    setRoots((r) => ({ ...r, [tool]: dir }));
    onChanged();
  };

  const reset = async (tool: Tool) => {
    await setRootOverride(tool, null);
    const next = await getRoot(tool);
    setRoots((r) => ({ ...r, [tool]: next }));
    onChanged();
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 text-[12px]">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Settings</h1>

        <Section title="Appearance">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-foreground">Theme</span>
              <div className="flex gap-1 rounded-md border border-border p-0.5">
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      if (theme !== t) toggle();
                    }}
                    className={`cursor-pointer rounded px-3 py-1 capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                      theme === t
                        ? "bg-primary/15 text-primary"
                        : "text-text-dim hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground">Syntax highlighting</span>
              <select
                value={scheme}
                onChange={(e) =>
                  setScheme(e.target.value as (typeof HIGHLIGHT_SCHEMES)[number]["id"])
                }
                aria-label="Syntax highlighting scheme"
                className="native-select cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {HIGHLIGHT_SCHEMES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <SchemePreview scheme={scheme} dark={theme === "dark"} />
          </div>
        </Section>

        <Section title="Workspace">
          <div className="flex flex-col gap-3">
            {(["soql", "apex"] as Tool[]).map((tool) => (
              <div key={tool} className="flex flex-col gap-1">
                <span className="text-text-dim">
                  {tool} workspace
                </span>
                <span className="truncate text-foreground" title={roots[tool]}>
                  {roots[tool] || "…"}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void pick(tool)}
                    className="cursor-pointer rounded-md px-2 py-0.5 text-text-dim hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    Change…
                  </button>
                  <button
                    type="button"
                    onClick={() => void reset(tool)}
                    className="cursor-pointer rounded-md px-2 py-0.5 text-text-dim hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Indexing">
          <div className="flex flex-col gap-1">
            <span className="text-text-dim">index scope</span>
            <select
              value={ns}
              onChange={(e) => void changeNs(e.target.value)}
              className="native-select cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Index namespace scope"
            >
              <option value="all">All objects</option>
              <option value="unmanaged">Unmanaged only (skip managed packages)</option>
            </select>
          </div>
        </Section>

        <Section title="About">
          <div className="flex items-center justify-between">
            <span className="text-foreground">
              Ultraforce{version && ` v${version}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void checkForUpdates(true)}
              className="cursor-pointer text-text-dim hover:text-foreground"
            >
              Check for updates
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}
