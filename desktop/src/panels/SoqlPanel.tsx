import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { SoqlEditor } from "../components/SoqlEditor";
import { ResultTable } from "../components/ResultTable";
import type { TableDto } from "../types";

const DEFAULT_QUERY = "SELECT Id, Name FROM Account LIMIT 10";

/** SOQL tool: editor on top, result table / error / empty state below. */
export function SoqlPanel() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<TableDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const dto = await invoke<TableDto>("run_soql", { query });
      setResult(dto);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setRunning(false);
    }
  }, [query]);

  return (
    <PanelGroup direction="vertical">
      <Panel defaultSize={40} minSize={20}>
        <SoqlEditor
          value={query}
          onChange={setQuery}
          onRun={run}
          running={running}
        />
      </Panel>
      <PanelResizeHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-accent data-[resize-handle-state=drag]:bg-accent" />
      <Panel defaultSize={60} minSize={20}>
        {error ? (
          <div className="flex h-full flex-col">
            <div className="micro-label px-4 py-2">RESULT</div>
            <pre className="mx-4 mb-4 flex-1 overflow-auto whitespace-pre-wrap rounded-[3px] border border-red/40 bg-surface p-3 text-[12px] text-red">
              {error}
            </pre>
          </div>
        ) : result ? (
          <ResultTable data={result} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="micro-label px-4 py-2">RESULT</div>
            <div className="flex flex-1 items-center justify-center text-text-faint text-[13px]">
              — run a query —
            </div>
          </div>
        )}
      </Panel>
    </PanelGroup>
  );
}
