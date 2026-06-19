import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw, Loader2 } from "lucide-react";
import type { LogRefDto, LogViewDto } from "../types";

function isSuccess(status: string): boolean {
  return status.toLowerCase() === "success";
}

/** Debug Logs: a refreshable list on the left, selected log's raw view right. */
export function LogsPanel() {
  const [logs, setLogs] = useState<LogRefDto[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<LogViewDto | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const refresh = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const rows = await invoke<LogRefDto[]>("list_logs");
      setLogs(rows);
    } catch (e) {
      setListError(typeof e === "string" ? e : String(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    setViewLoading(true);
    setViewError(null);
    setView(null);
    try {
      const dto = await invoke<LogViewDto>("get_log", { id });
      setView(dto);
    } catch (e) {
      setViewError(typeof e === "string" ? e : String(e));
    } finally {
      setViewLoading(false);
    }
  }, []);

  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={38} minSize={22}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="micro-label flex-1">LOGS</div>
            <button
              type="button"
              onClick={refresh}
              disabled={listLoading}
              title="Refresh"
              className="focus-accent inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-text-dim hover:text-text disabled:opacity-40 cursor-pointer"
            >
              {listLoading ? (
                <Loader2 size={12} className="spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              REFRESH
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {listError ? (
              <pre className="m-4 overflow-auto whitespace-pre-wrap rounded-[3px] border border-red/40 bg-surface p-3 text-[12px] text-red">
                {listError}
              </pre>
            ) : logs.length === 0 && !listLoading ? (
              <div className="flex h-full items-center justify-center text-text-faint text-[13px]">
                — no logs —
              </div>
            ) : (
              logs.map((log) => {
                const ok = isSuccess(log.status);
                const selected = log.id === selectedId;
                return (
                  <button
                    key={log.id}
                    type="button"
                    onClick={() => select(log.id)}
                    className={`focus-accent relative flex w-full items-center gap-2 border-b border-hair px-4 py-2 text-left hover:bg-surface-3 cursor-pointer ${
                      selected ? "bg-accent/10" : ""
                    }`}
                  >
                    {selected && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-accent" />
                    )}
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        ok ? "bg-accent" : "bg-red"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-text">
                      {log.operation}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${
                        ok ? "text-accent" : "text-red"
                      }`}
                    >
                      {log.status}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Panel>

      <PanelResizeHandle className="w-px bg-line transition-colors data-[resize-handle-state=hover]:bg-accent data-[resize-handle-state=drag]:bg-accent" />

      <Panel defaultSize={62} minSize={30}>
        <div className="flex h-full flex-col">
          <div className="micro-label px-4 py-2">LOG DETAIL</div>

          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center text-text-faint text-[13px]">
              — select a log —
            </div>
          ) : viewLoading ? (
            <div className="flex flex-1 items-center justify-center text-text-faint">
              <Loader2 size={18} className="spin" />
            </div>
          ) : viewError ? (
            <pre className="mx-4 mb-4 flex-1 overflow-auto whitespace-pre-wrap rounded-[3px] border border-red/40 bg-surface p-3 text-[12px] text-red">
              {viewError}
            </pre>
          ) : view ? (
            <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
              <div className="tnum pb-2 text-[12px] text-text-dim">
                API {view.api_version ?? "—"} · {view.unit_count}{" "}
                {view.unit_count === 1 ? "unit" : "units"}
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre rounded-[3px] border border-hair bg-surface p-3 text-[12px] text-text-dim">
                {view.raw}
              </pre>
            </div>
          ) : null}
        </div>
      </Panel>
    </PanelGroup>
  );
}
