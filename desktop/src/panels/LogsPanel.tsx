import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw, Loader2 } from "lucide-react";
import { LogView } from "../components/LogView";
import type {
  ExecNodeDto,
  LogRefDto,
  LogViewDto,
  UnitDto,
} from "../types";

function isSuccess(status: string): boolean {
  return status.toLowerCase() === "success";
}

type DetailTab = "tree" | "limits" | "raw";

/** Format a nanosecond duration as a compact millisecond string. */
function formatMs(durNs: number): string {
  return `${(durNs / 1_000_000).toFixed(durNs < 1_000_000 ? 3 : 2)} ms`;
}

/** One execution-tree node, rendered with indentation and right-aligned ms. */
function TreeNode({ node, depth }: { node: ExecNodeDto; depth: number }) {
  return (
    <>
      <div
        className="flex items-baseline gap-2 border-b border-hair/50 py-0.5 text-[12px]"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <span className="shrink-0 text-text">{node.label}</span>
        {node.detail && (
          <span className="min-w-0 flex-1 truncate text-text-faint">
            {node.detail}
          </span>
        )}
        {node.dur_ns != null && (
          <span className="tnum ml-auto shrink-0 text-text-dim">
            {formatMs(node.dur_ns)}
          </span>
        )}
      </div>
      {node.children.map((child, i) => (
        <TreeNode key={i} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

/** Governor-limit rollup tables, one heading per namespace. */
function LimitsView({ units }: { units: UnitDto[] }) {
  const rollups = units.flatMap((u) => u.limits);
  if (rollups.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-text-faint">
        — no limit usage —
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {rollups.map((rollup, ri) => (
        <div key={ri}>
          <div className="micro-label pb-1">
            {rollup.namespace || "(default)"}
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-text-faint">
                <th className="py-1 text-left font-normal">NAME</th>
                <th className="py-1 text-right font-normal">USED</th>
                <th className="py-1 text-right font-normal">MAX</th>
              </tr>
            </thead>
            <tbody>
              {rollup.entries.map((e, ei) => {
                const hot = e.used >= e.max && e.max > 0;
                return (
                  <tr
                    key={ei}
                    className={`border-t border-hair/50 ${
                      hot ? "text-red" : "text-text-dim"
                    }`}
                  >
                    <td className="py-0.5 pr-2 text-text">{e.name}</td>
                    <td className="tnum py-0.5 text-right">{e.used}</td>
                    <td className="tnum py-0.5 text-right">{e.max}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
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
  const [tab, setTab] = useState<DetailTab>("tree");

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
    setTab("tree");
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
                        ok ? "bg-success" : "bg-red"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-text">
                      {log.operation}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${
                        ok ? "text-success" : "text-red"
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
              <div className="flex items-center justify-between pb-2">
                <div className="tnum text-[12px] text-text-dim">
                  API {view.api_version ?? "—"} · {view.units.length}{" "}
                  {view.units.length === 1 ? "unit" : "units"}
                </div>
                <div className="flex gap-1">
                  {(["tree", "limits", "raw"] as DetailTab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`focus-accent rounded-[3px] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide cursor-pointer ${
                        tab === t
                          ? "bg-accent/15 text-accent"
                          : "text-text-dim hover:text-text"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {tab === "raw" ? (
                <div className="min-h-0 flex-1 overflow-hidden rounded-[3px] border border-hair">
                  <LogView raw={view.raw} />
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto rounded-[3px] border border-hair bg-surface p-3">
                  {tab === "tree" ? (
                    view.units.length === 0 ||
                    view.units.every((u) => u.tree.length === 0) ? (
                      <div className="py-4 text-center text-[13px] text-text-faint">
                        — no execution tree —
                      </div>
                    ) : (
                      view.units.map((unit, ui) => (
                        <div key={ui} className={ui > 0 ? "mt-4" : ""}>
                          {view.units.length > 1 && (
                            <div className="micro-label pb-1">
                              UNIT {ui + 1}
                            </div>
                          )}
                          {unit.tree.map((node, ni) => (
                            <TreeNode key={ni} node={node} depth={0} />
                          ))}
                        </div>
                      ))
                    )
                  ) : (
                    <LimitsView units={view.units} />
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </Panel>
    </PanelGroup>
  );
}
