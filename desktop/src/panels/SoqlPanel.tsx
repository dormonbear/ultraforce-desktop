import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { SoqlEditor } from "../components/SoqlEditor";
import { ResultTable } from "../components/ResultTable";
import { RecordTree } from "../components/RecordTree";
import type { SoqlResultDto } from "../types";

const DEFAULT_QUERY = "SELECT Id, Name FROM Account LIMIT 10";

/** SOQL tool: editor on top, Table/Tree result toggle + status line below. */
export function SoqlPanel() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<SoqlResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"table" | "tree">("table");

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await invoke<SoqlResultDto>("run_soql", { query }));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setRunning(false);
    }
  }, [query]);

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
        <SoqlEditor value={query} onChange={setQuery} onRun={run} running={running} />
      </Panel>
      <PanelResizeHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-accent data-[resize-handle-state=drag]:bg-accent" />
      <Panel defaultSize={60} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-hair px-4 py-1.5">
            <div className="flex gap-1">
              {(["table", "tree"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`focus-accent cursor-pointer rounded-[3px] px-2 py-0.5 text-[11px] uppercase tracking-wide transition-colors ${
                    view === v ? "text-accent" : "text-text-dim hover:text-text"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
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
