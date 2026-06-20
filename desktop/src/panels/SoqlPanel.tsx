import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SoqlEditor } from "../components/SoqlEditor";
import { ResultTable } from "../components/ResultTable";
import { RecordTree } from "../components/RecordTree";
import type { SoqlResultDto } from "../types";
import type { SoqlTab } from "../tabs/types";

interface SoqlViewProps {
  tab: SoqlTab;
  onPatch: (partial: Partial<SoqlTab>) => void;
}

/** SOQL tool (single tab): editor on top, Table/Tree result toggle + status line below. */
export function SoqlView({ tab, onPatch }: SoqlViewProps) {
  const { query, result, error, view } = tab;
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    onPatch({ error: null });
    try {
      const dto = await invoke<SoqlResultDto>("run_soql", { query });
      onPatch({ result: dto });
    } catch (e) {
      onPatch({ error: typeof e === "string" ? e : String(e) });
    } finally {
      setRunning(false);
    }
  }, [query, onPatch]);

  const status = running
    ? "Executing…"
    : error
      ? "error"
      : result
        ? `${result.total_size} row${result.total_size === 1 ? "" : "s"} returned`
        : "";

  return (
    <PanelGroup direction="vertical">
      <Panel defaultSize={40} minSize={20}>
        <SoqlEditor
          value={query}
          onChange={(v) => onPatch({ query: v })}
          onRun={run}
          running={running}
        />
      </Panel>
      <PanelResizeHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />
      <Panel defaultSize={60} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-hair px-4 py-1.5">
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
                  className="focus-accent h-auto cursor-pointer rounded-[3px] px-2 py-0.5 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-text data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
                >
                  {v}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <span className="tnum text-[11px] text-text-dim">{status}</span>
          </div>
          <div className="min-h-0 flex-1">
            {error ? (
              <pre className="m-4 overflow-auto whitespace-pre-wrap rounded-[3px] border border-red/40 bg-surface p-3 text-[12px] text-red">
                {error}
              </pre>
            ) : !result ? (
              <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
                — run a query —
              </div>
            ) : view === "table" ? (
              <ResultTable data={result} />
            ) : (
              <RecordTree records={result.tree} />
            )}
          </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}
