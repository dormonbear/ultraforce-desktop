import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SoqlEditor } from "../components/SoqlEditor";
import type { Reveal } from "../monaco-reveal";
import { ResultTable } from "../components/ResultTable";
import { RecordTree } from "../components/RecordTree";
import { useOrgs } from "../org";
import { recordHistory } from "../history";
import { timing } from "../metrics";
import { parseSfError } from "../errorFormat";
import type { SoqlResultDto } from "../types";
import type { SoqlTab } from "../tabs/types";

interface SoqlViewProps {
  tab: SoqlTab;
  onPatch: (partial: Partial<SoqlTab>) => void;
  reveal?: Reveal;
}

/** SOQL tool (single tab): editor on top, Table/Tree result toggle + status line below. */
export function SoqlView({ tab, onPatch, reveal }: SoqlViewProps) {
  const { query, result, error, view, useToolingApi } = tab;
  const [running, setRunning] = useState(false);
  const { selected: org } = useOrgs();
  // Persist the editor/results split to localStorage; restored on next launch.
  // First run falls back to the editor's ~5-line default size below.
  const layout = useDefaultLayout({
    id: "uf-soql-split",
    panelIds: ["editor", "results"],
    storage: localStorage,
  });

  const run = useCallback(async () => {
    setRunning(true);
    onPatch({ error: null });
    const t0 = performance.now();
    try {
      const dto = await invoke<SoqlResultDto>("run_soql", {
        query,
        useToolingApi,
      });
      onPatch({ result: dto });
      const ms = performance.now() - t0;
      void timing("run.soql", ms);
      void recordHistory({
        tool: "soql",
        org,
        text: query,
        status: "success",
        durationMs: ms,
        rowCount: dto.total_size,
      });
    } catch (e) {
      const message = typeof e === "string" ? e : String(e);
      toast.error(parseSfError(message).detail);
      onPatch({ error: message });
      const ms = performance.now() - t0;
      void timing("run.soql", ms);
      void recordHistory({
        tool: "soql",
        org,
        text: query,
        status: "error",
        durationMs: ms,
      });
    } finally {
      setRunning(false);
    }
  }, [query, onPatch, org, useToolingApi]);

  const status = running
    ? "Executing…"
    : error
      ? "error"
      : result
        ? `${result.total_size} row${result.total_size === 1 ? "" : "s"} returned`
        : "";

  return (
    <ResizablePanelGroup
      direction="vertical"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <ResizablePanel id="editor" defaultSize="150px" minSize="80px">
        <SoqlEditor
          value={query}
          onChange={(v) => onPatch({ query: v })}
          onRun={run}
          running={running}
          reveal={reveal}
        />
      </ResizablePanel>
      <ResizableHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />
      <ResizablePanel id="results" minSize="160px">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
            <div className="flex items-center gap-3">
              <ToggleGroup
                type="single"
                value={view}
                onValueChange={(next) => {
                  if (next) onPatch({ view: next as typeof view });
                }}
                className="gap-1"
              >
                {(["table", "tree"] as const).map((v) => (
                  <ToggleGroupItem
                    key={v}
                    value={v}
                    className="focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-foreground data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
                  >
                    {v}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <label
                className="flex cursor-pointer items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-foreground"
                title="Query Tooling API objects (ApexClass, ApexTrigger, …)"
              >
                <input
                  type="checkbox"
                  checked={useToolingApi}
                  onChange={(e) => onPatch({ useToolingApi: e.target.checked })}
                  className="size-3 cursor-pointer accent-primary"
                />
                Tooling API
              </label>
            </div>
            <span className="tnum text-[11px] text-text-dim">{status}</span>
          </div>
          <div className="min-h-0 flex-1">
            {error ? (
              (() => {
                const e = parseSfError(error);
                return (
                  <div className="m-4 rounded-md border border-destructive/40 bg-card p-3">
                    <div className="text-[13px] font-medium text-destructive">
                      {e.title}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-[12px] text-foreground">
                      {e.detail}
                    </div>
                    {e.raw !== e.detail && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-text-dim">
                          Raw error
                        </summary>
                        <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[11px] text-text-dim">
                          {e.raw}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })()
            ) : !result ? (
              <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
                — run a query —
              </div>
            ) : view === "table" ? (
              <ResultTable data={result} />
            ) : (
              <RecordTree records={result.tree} />
            )}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
