import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import {
  RefreshCw,
  Loader2,
  FolderOpen,
  Download,
  HardDriveDownload,
  Search,
  SlidersHorizontal,
  Bug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeBreakdownBar } from "./TimeBreakdownBar";
import {
  usagePct,
  limitSeverity,
  rankByUsage,
  type LimitSeverity,
} from "./limitStats";
import { groupByFingerprint, totalNs } from "./queryStats";
import { detectInsights, type Severity } from "./insights";
import { collectUserDebug } from "./debugLines";
import { parseSourceRef, type SourceRef } from "./sourceRef";
import {
  filterLogs,
  fmtDuration,
  fmtSize,
  fmtTime,
  EMPTY_FILTER,
  type LogFilter,
} from "./logList";
import { SourceDialog } from "../components/SourceDialog";
import { LogDebugger } from "../components/LogDebugger";
import {
  loadCachedList,
  saveCachedList,
  listCachedIds,
  readCachedBody,
  writeCachedBody,
  loadLogView,
} from "./logCache";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LogView } from "../components/LogView";
import { TimelineView } from "./TimelineView";
import { clearApexSourceCache } from "../components/useApexSource";
import { LoggingConfigDialog } from "../components/LoggingConfigDialog";
import { useOrgs } from "../org";
import type {
  HotspotDto,
  LogRefDto,
  LogViewDto,
  StatementDto,
  UnitDto,
} from "../types";

function isSuccess(status: string): boolean {
  return status.toLowerCase() === "success";
}

type DetailTab =
  | "insights"
  | "hotspots"
  | "queries"
  | "limits"
  | "debug"
  | "raw"
  | "timeline";

/** Format a nanosecond duration as a compact millisecond string. */
function formatMs(durNs: number): string {
  return `${(durNs / 1_000_000).toFixed(durNs < 1_000_000 ? 3 : 2)} ms`;
}

/** Format a byte count compactly (B / KB / MB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const SEVERITY_BAR: Record<LimitSeverity, string> = {
  ok: "bg-text-dim",
  warn: "bg-amber-500",
  crit: "bg-destructive",
};
const SEVERITY_TEXT: Record<LimitSeverity, string> = {
  ok: "text-text-dim",
  warn: "text-amber-500",
  crit: "text-destructive",
};

const INSIGHT_DOT: Record<Severity, string> = {
  crit: "bg-destructive",
  warn: "bg-amber-500",
  info: "bg-primary",
};

/** Which tab a finding's evidence lives in, so the user can jump straight to it. */
const FINDING_TAB: Record<string, DetailTab> = {
  exception: "raw",
  "stmt-in-loop": "queries",
  "slow-query": "queries",
  limit: "limits",
  recursion: "timeline",
  "loop-body": "timeline",
  "method-loop": "timeline",
  "critical-path": "timeline",
};

/** Insights: rule-based diagnostics (exceptions, SOQL/DML-in-loop, loop bodies,
 * repeated methods, recursion, large/slow queries, governor limits, critical
 * path) with a one-line fix and a jump to the evidence — the analyser layer on
 * top of the raw/timeline viewers. */
function InsightsView({
  units,
  onGoto,
}: {
  units: UnitDto[];
  onGoto: (tab: DetailTab) => void;
}) {
  const findings = detectInsights(units);
  if (findings.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No issues detected
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {findings.map((f, i) => {
        const goto = FINDING_TAB[f.kind];
        return (
          <div key={i} className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <div className="flex items-baseline gap-2">
              <span
                className={`mt-1 size-1.5 shrink-0 rounded-full ${INSIGHT_DOT[f.severity]}`}
              />
              <span className="text-[12px] font-medium text-foreground">{f.title}</span>
              {goto && (
                <button
                  type="button"
                  onClick={() => onGoto(goto)}
                  className="ml-auto shrink-0 cursor-pointer text-[11px] text-text-dim/70 hover:text-primary"
                >
                  View {goto} →
                </button>
              )}
            </div>
            <div className="mt-0.5 break-words pl-3.5 text-[11px] text-text-dim">
              {f.detail}
            </div>
            {f.fix && (
              <div className="mt-1 pl-3.5 text-[11px] text-muted-foreground">
                <span className="text-text-dim/70">Fix: </span>
                {f.fix}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Governor-limit dashboard: per namespace, each limit as a usage bar ranked
 * tightest-first, so the limit closest to breaching is obvious at a glance. */
function LimitsView({ units }: { units: UnitDto[] }) {
  const rollups = units.flatMap((u) => u.limits);
  if (rollups.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No limit usage
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {rollups.map((rollup, ri) => (
        <div key={ri}>
          <div className="micro-label pb-1.5">
            {rollup.namespace || "(default)"}
          </div>
          <div className="flex flex-col gap-1.5">
            {rankByUsage(rollup.entries).map((e, ei) => {
              const sev = limitSeverity(e.used, e.max);
              const pct = usagePct(e.used, e.max);
              return (
                <div key={ei} className="text-[12px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-foreground">{e.name}</span>
                    <span className={`tnum shrink-0 ${SEVERITY_TEXT[sev]}`}>
                      {e.used}/{e.max}
                      {e.max > 0 ? ` · ${pct}%` : ""}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-border">
                    <span
                      className={`block h-full rounded-full ${SEVERITY_BAR[sev]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Aggregate hotspots: top method/unit frames by self time across the log. */
function HotspotsView({
  units,
  onSource,
}: {
  units: UnitDto[];
  onSource: (ref: SourceRef) => void;
}) {
  const all = units.flatMap((u) => u.hotspots);
  if (all.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No method frames
      </div>
    );
  }
  // Merge by signature across units, then sort by self time descending.
  const merged = new Map<string, HotspotDto>();
  for (const h of all) {
    const m = merged.get(h.signature);
    if (m) {
      m.self_ns += h.self_ns;
      m.total_ns += h.total_ns;
      m.self_bytes += h.self_bytes;
      m.count += h.count;
    } else {
      merged.set(h.signature, { ...h });
    }
  }
  const rows = [...merged.values()].sort((a, b) => b.self_ns - a.self_ns);
  const maxSelf = rows[0].self_ns; // rows are sorted desc by self_ns; non-empty (see `all` check above)
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-muted-foreground">
          <th className="py-1 text-left font-normal">Method</th>
          <th className="py-1 text-right font-normal">Self</th>
          <th className="py-1 text-right font-normal">Total</th>
          <th className="py-1 text-right font-normal">Heap</th>
          <th className="py-1 text-right font-normal">Calls</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h, i) => {
          const ref = parseSourceRef(h.signature);
          return (
          <tr key={i} className="border-t border-border/50 text-text-dim">
            <td
              className="relative max-w-0 truncate py-0.5 pr-2 text-foreground"
              title={h.signature}
            >
              <span
                className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-primary/10"
                style={{ width: `${maxSelf > 0 ? (h.self_ns / maxSelf) * 100 : 0}%` }}
                aria-hidden
              />
              {ref ? (
                <button
                  type="button"
                  onClick={() => onSource(ref)}
                  title="Jump to source"
                  className="cursor-pointer truncate text-left hover:text-primary hover:underline"
                >
                  {h.signature}
                </button>
              ) : (
                h.signature
              )}
            </td>
            <td className="tnum py-0.5 text-right text-foreground">
              {formatMs(h.self_ns)}
            </td>
            <td className="tnum py-0.5 text-right">{formatMs(h.total_ns)}</td>
            <td className="tnum py-0.5 text-right">
              {h.self_bytes > 0 ? formatBytes(h.self_bytes) : "—"}
            </td>
            <td className="tnum py-0.5 text-right">{h.count}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Debug output: every USER_DEBUG message in order, away from the raw-log noise. */
function DebugView({ units }: { units: UnitDto[] }) {
  const lines = collectUserDebug(units);
  if (lines.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No debug output
      </div>
    );
  }
  return (
    <div className="flex flex-col font-mono text-[11px]">
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2 border-b border-border/40 py-0.5">
          <span className="tnum w-8 shrink-0 text-right text-text-dim/50">{i + 1}</span>
          <span className="break-words text-foreground">{l}</span>
        </div>
      ))}
    </div>
  );
}

/** SOQL/DML statements: a per-unit summary + queries grouped by text, ranked by
 * total DB time (hotspot first). Count > 1 is the N+1 signal. */
function QueriesView({ units }: { units: UnitDto[] }) {
  const all = units.flatMap((u) => u.statements);
  if (all.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No SOQL or DML
      </div>
    );
  }
  const soql = all.filter((s) => s.kind === "soql");
  const dml = all.filter((s) => s.kind === "dml");
  const sumRows = (xs: StatementDto[]) => xs.reduce((n, s) => n + s.rows, 0);

  const families = groupByFingerprint(all);
  const maxNs = families.length > 0 ? families[0].totalNs : 0;
  const soqlNs = totalNs(soql);
  const dmlNs = totalNs(dml);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] text-text-dim">
        <span className="text-foreground">{soql.length}</span> SOQL ({sumRows(soql)} rows
        {soqlNs > 0 ? `, ${formatMs(soqlNs)}` : ""})
        {" · "}
        <span className="text-foreground">{dml.length}</span> DML ({sumRows(dml)} rows
        {dmlNs > 0 ? `, ${formatMs(dmlNs)}` : ""})
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-left font-normal">Statement</th>
            <th className="py-1 text-right font-normal">Time</th>
            <th className="py-1 text-right font-normal">×</th>
            <th className="py-1 text-right font-normal">Rows</th>
          </tr>
        </thead>
        <tbody>
          {families.map((g, i) => (
            <tr
              key={i}
              className={`border-t border-border/50 ${g.count > 1 ? "text-destructive" : "text-text-dim"}`}
              title={g.count > 1 ? "run more than once — possible N+1 / loop" : g.sample}
            >
              <td className="relative max-w-0 truncate py-0.5 pr-2 text-foreground" title={g.sample}>
                <span
                  className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-success/10"
                  style={{ width: `${maxNs > 0 ? (g.totalNs / maxNs) * 100 : 0}%` }}
                  aria-hidden
                />
                <span className="text-text-dim/70">{g.kind === "dml" ? "DML " : "SOQL "}</span>
                {g.sample}
              </td>
              <td className="tnum py-0.5 text-right">{g.totalNs > 0 ? formatMs(g.totalNs) : "—"}</td>
              <td className="tnum py-0.5 text-right">{g.count}</td>
              <td className="tnum py-0.5 text-right">{g.rows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Debug Logs: a refreshable list on the left, selected log's raw view right. */
export function LogsPanel() {
  const { selected: org } = useOrgs();
  const [cfgOpen, setCfgOpen] = useState(false);
  const [logs, setLogs] = useState<LogRefDto[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<LogViewDto | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  // Apex source to show (jump-to-source from a method node / hotspot).
  const [sourceRef, setSourceRef] = useState<SourceRef | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>("raw");
  const [filter, setFilter] = useState<LogFilter>(EMPTY_FILTER);
  const visibleLogs = filterLogs(logs, filter);

  // Virtualize the log list — it can run to thousands of rows.
  const listParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: visibleLogs.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 57,
    overscan: 10,
  });
  // Parsed-log cache (logs are immutable once written). Avoids re-fetching a
  // large log from the org on every click; cleared on org switch / REFRESH.
  const viewCache = useRef<Map<string, LogViewDto>>(new Map());
  // Id of the log whose Apex source cache is currently held (null = local file).
  const lastLogId = useRef<string | null>(null);
  // Log ids whose body is cached on disk — drives the "downloaded" list marker.
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void listCachedIds().then(setCachedIds);
  }, []);

  const refresh = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    viewCache.current.clear();
    try {
      const rows = await invoke<LogRefDto[]>("list_logs");
      setLogs(rows);
      void saveCachedList(org ?? "default", rows);
    } catch (e) {
      setListError(typeof e === "string" ? e : String(e));
    } finally {
      setListLoading(false);
    }
  }, [org]);

  // On org change (and mount): show the persisted list head immediately so
  // reopening the app needs no download, then refresh from the org in the
  // background. Drops any selection from the previous org.
  useEffect(() => {
    setSelectedId(null);
    setView(null);
    setViewError(null);
    // Different org → different source; drop the Apex source cache.
    clearApexSourceCache();
    lastLogId.current = null;
    let alive = true;
    void loadCachedList(org ?? "default").then((rows) => {
      // Don't clobber a fresh background refresh with an empty/stale cache.
      if (alive && rows.length) setLogs(rows);
    });
    void refresh();
    return () => {
      alive = false;
    };
  }, [refresh, org]);

  const select = useCallback(async (id: string) => {
    // Switching to a different log: drop the previous log's Apex source cache.
    if (lastLogId.current !== id) {
      clearApexSourceCache();
      lastLogId.current = id;
    }
    setSelectedId(id);
    setViewError(null);
    setTab("raw");
    const cached = viewCache.current.get(id);
    if (cached) {
      setView(cached);
      setViewLoading(false);
      return;
    }
    setView(null);
    setViewLoading(true);
    try {
      // Cache-first (logs are immutable): parse a locally cached body, else
      // download from the org and write it to cache for next time.
      const dto = await loadLogView(id, {
        readCache: readCachedBody,
        // parse_log omits raw; re-attach the body we already hold (no 16MB echo).
        parse: async (body) => ({
          raw: body,
          ...(await invoke<Omit<LogViewDto, "raw">>("parse_log", { body })),
        }),
        getLog: (logId) => invoke<LogViewDto>("get_log", { id: logId }),
        writeCache: writeCachedBody,
      });
      viewCache.current.set(id, dto);
      setView(dto);
      // loadLogView writes the body to disk on a download; reflect that marker.
      setCachedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    } catch (e) {
      setViewError(typeof e === "string" ? e : String(e));
    } finally {
      setViewLoading(false);
    }
  }, []);

  /** Open a local `.log` file, parse it (no org fetch), and show it. */
  const openLocal = useCallback(async () => {
    const path = await openDialog({
      filters: [{ name: "Debug log", extensions: ["log", "txt"] }],
    });
    if (typeof path !== "string") return;
    setSelectedId(null);
    // A freshly opened local log: start with an empty Apex source cache.
    clearApexSourceCache();
    lastLogId.current = null;
    setViewLoading(true);
    setViewError(null);
    setView(null);
    setTab("raw");
    try {
      const body = await readTextFile(path);
      const parsed = await invoke<Omit<LogViewDto, "raw">>("parse_log", { body });
      setView({ raw: body, ...parsed });
    } catch (e) {
      setViewError(typeof e === "string" ? e : String(e));
    } finally {
      setViewLoading(false);
    }
  }, []);

  /** Save the currently-viewed log's raw body to disk. */
  const saveLog = useCallback(async () => {
    if (!view) return;
    const path = await saveDialog({
      defaultPath: "debug.log",
      filters: [{ name: "Debug log", extensions: ["log"] }],
    });
    if (!path) return;
    try {
      await writeTextFile(path, view.raw);
      toast.success("Log saved");
    } catch (e) {
      toast.error(`Save failed: ${typeof e === "string" ? e : String(e)}`);
    }
  }, [view]);

  return (
    <ResizablePanelGroup direction="horizontal">
      {/* minSize = the natural width of the header toolbar (LOGS · OPEN ·
          SAVE · REFRESH · LOGGING) so those buttons never clip.
          NOTE: this resizable lib wants string px/% sizes, not bare numbers. */}
      <ResizablePanel
        defaultSize="40%"
        minSize="450px"
        groupResizeBehavior="preserve-pixel-size"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="micro-label flex-1">Logs</div>
            <Button
              variant="ghost"
              size="sm"
              onClick={openLocal}
              title="Open a local .log file"
              className="h-7 cursor-pointer gap-1 px-1.5 text-[11px] text-text-dim hover:text-foreground"
            >
              <FolderOpen size={12} />
              Open
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={saveLog}
              disabled={!view}
              title="Save the viewed log to a file"
              className="h-7 cursor-pointer gap-1 px-1.5 text-[11px] text-text-dim hover:text-foreground"
            >
              <Download size={12} />
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={listLoading}
              className="h-7 cursor-pointer gap-1 px-1.5 text-[11px] text-text-dim hover:text-foreground"
            >
              {listLoading ? (
                <Loader2 size={12} className="spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Configure logging"
              onClick={() => setCfgOpen(true)}
              className="h-7 cursor-pointer gap-1 px-1.5 text-[11px] text-text-dim hover:text-foreground"
            >
              <SlidersHorizontal size={12} />
              Logging
            </Button>
          </div>

          {cfgOpen && (
            <LoggingConfigDialog open onOpenChange={setCfgOpen} org={org} />
          )}

          {logs.length > 0 && (
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <div className="relative flex-1">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
                />
                <Input
                  value={filter.query}
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, query: e.target.value }))
                  }
                  placeholder="Filter operation / user"
                  className="h-7 pl-7 text-[12px]"
                />
              </div>
            </div>
          )}

          {listError ? (
            <pre className="m-4 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-card p-3 text-[12px] text-destructive">
              {listError}
            </pre>
          ) : logs.length === 0 && !listLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-[13px]">
              No logs
            </div>
          ) : visibleLogs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-[13px]">
              No matches
            </div>
          ) : (
            <div ref={listParentRef} className="uf-scroll min-h-0 flex-1 overflow-y-auto">
              <div
                style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
              >
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const log = visibleLogs[vi.index];
                  const ok = isSuccess(log.status);
                  const selected = log.id === selectedId;
                  const cached = cachedIds.has(log.id);
                  const time = fmtTime(log.start_time);
                  return (
                    <button
                      key={log.id}
                      data-index={vi.index}
                      ref={rowVirtualizer.measureElement}
                      type="button"
                      onClick={() => select(log.id)}
                      className={`focus-accent absolute left-0 top-0 flex w-full items-stretch gap-2 border-b border-border py-2 pl-4 pr-4 text-left hover:bg-accent cursor-pointer ${
                        selected ? "bg-primary/10" : ""
                      }`}
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      {selected && (
                        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-primary" />
                      )}
                      {/* Vertical timeline rail (continuous across rows) + status node. */}
                      <div className="relative flex w-4 shrink-0 items-center justify-center">
                        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                        <span
                          className={`relative z-10 h-2 w-2 rounded-full ring-2 ring-background ${
                            ok ? "bg-success" : "bg-destructive"
                          }`}
                        />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex w-full items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                            {log.operation}
                          </span>
                          {cached && (
                            <HardDriveDownload
                              size={12}
                              className="shrink-0 text-text-dim"
                              aria-label="Cached locally"
                            />
                          )}
                          <Badge
                            variant={ok ? "success" : "destructive"}
                            title={log.status}
                            className="shrink-0 px-1.5 py-0 text-[10px]"
                          >
                            {ok ? "Success" : "Failed"}
                          </Badge>
                        </div>
                        <div className="tnum flex w-full items-center gap-2 text-[10px] text-text-dim">
                          {log.user && (
                            <span className="max-w-[45%] truncate">{log.user}</span>
                          )}
                          <span>{fmtDuration(log.duration_ms)}</span>
                          <span>{fmtSize(log.log_length)}</span>
                          {time && <span className="ml-auto">{time}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle className="w-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />

      <ResizablePanel minSize="360px">
        <div className="flex h-full flex-col">
          <div className="micro-label px-4 py-2">Log detail</div>

          {!selectedId && !view && !viewLoading && !viewError ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground text-[13px]">
              Select a log
            </div>
          ) : viewLoading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 size={18} className="spin" />
            </div>
          ) : viewError ? (
            <pre className="select-text mx-4 mb-4 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-card p-3 text-[12px] text-destructive">
              {viewError}
            </pre>
          ) : view ? (
            <div className="select-text flex min-h-0 flex-1 flex-col px-4 pb-4">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="tnum text-[12px] text-text-dim">
                    API {view.api_version ?? "—"} · {view.units.length}{" "}
                    {view.units.length === 1 ? "unit" : "units"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDebugOpen(true)}
                    className="focus-accent flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Bug size={13} /> Debug
                  </button>
                </div>
                <ToggleGroup
                  type="single"
                  value={tab}
                  onValueChange={(next) => {
                    if (next) setTab(next as DetailTab);
                  }}
                  className="gap-1"
                >
                  {([
                    "raw",
                    "insights",
                    "timeline",
                    "hotspots",
                    "queries",
                    "limits",
                    "debug",
                  ] as DetailTab[]).map((t) => (
                    <ToggleGroupItem
                      key={t}
                      value={t}
                      className="focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium capitalize text-text-dim hover:text-foreground data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
                    >
                      {t}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {tab === "raw" || tab === "timeline" ? (
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
                  {tab === "raw" ? (
                    <LogView
                      raw={view.raw}
                      resolveSource={(line) =>
                        invoke<SourceRef | null>("source_at_line", {
                          body: view.raw,
                          line,
                        })
                      }
                      onSource={setSourceRef}
                    />
                  ) : (
                    <TimelineView units={view.units} onSource={setSourceRef} />
                  )}
                </div>
              ) : (
                <ScrollArea className="min-h-0 flex-1 rounded-md border border-border bg-card">
                  <div className="p-3">
                  <TimeBreakdownBar units={view.units} />
                  {tab === "insights" ? (
                    <InsightsView units={view.units} onGoto={setTab} />
                  ) : tab === "hotspots" ? (
                    <HotspotsView units={view.units} onSource={setSourceRef} />
                  ) : tab === "queries" ? (
                    <QueriesView units={view.units} />
                  ) : tab === "debug" ? (
                    <DebugView units={view.units} />
                  ) : (
                    <LimitsView units={view.units} />
                  )}
                  </div>
                </ScrollArea>
              )}
            </div>
          ) : null}
        </div>
      </ResizablePanel>
      <SourceDialog target={sourceRef} onClose={() => setSourceRef(null)} />
      {view && (
        <LogDebugger
          raw={view.raw}
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
        />
      )}
    </ResizablePanelGroup>
  );
}
