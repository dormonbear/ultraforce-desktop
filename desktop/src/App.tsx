import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Database, Terminal, ScrollText, Table as TableIcon } from "lucide-react";
import { SoqlEditor } from "./components/SoqlEditor";
import { ResultTable } from "./components/ResultTable";
import type { TableDto } from "./types";

const DEFAULT_QUERY = "SELECT Id, Name FROM Account LIMIT 10";

const RAIL = [
  { id: "soql", icon: Database, label: "SOQL", active: true },
  { id: "apex", icon: Terminal, label: "Apex", active: false },
  { id: "logs", icon: ScrollText, label: "Logs", active: false },
  { id: "schema", icon: TableIcon, label: "Schema", active: false },
];

export default function App() {
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
    <div className="flex h-full flex-col bg-bg text-text">
      {/* 2px accent strip */}
      <div className="h-0.5 w-full bg-accent" />

      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-hair px-4">
        <span
          className="text-[20px] font-bold tracking-wide text-text"
          style={{ fontFamily: "var(--font-display)" }}
        >
          SF·TOOLKIT
        </span>
        <span className="inline-flex items-center gap-2 rounded-[3px] border border-hair px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          ORG default
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Activity rail */}
        <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-hair py-2">
          {RAIL.map(({ id, icon: Icon, label, active }) => (
            <button
              key={id}
              type="button"
              title={label}
              disabled={!active}
              aria-current={active ? "page" : undefined}
              className={`focus-accent relative flex h-9 w-9 items-center justify-center rounded-[3px] ${
                active
                  ? "text-accent"
                  : "text-text-faint hover:text-text-dim disabled:cursor-not-allowed"
              } cursor-pointer`}
            >
              {active && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-accent" />
              )}
              <Icon size={18} />
            </button>
          ))}
        </nav>

        {/* Main */}
        <main className="min-w-0 flex-1">
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
        </main>
      </div>
    </div>
  );
}
