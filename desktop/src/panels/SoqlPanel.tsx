import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SoqlEditor } from "../components/SoqlEditor";
import type { Reveal } from "../monaco-reveal";
import { ResultTable } from "../components/ResultTable";
import { RecordTree } from "../components/RecordTree";
import { QueryPlanView } from "../components/QueryPlanView";
import { useOrgs } from "../org";
import { recordHistory } from "../history";
import { timing } from "../metrics";
import { parseSfError, isCliUnavailable } from "../errorFormat";
import { CliGuidanceForError } from "../components/CliGuidance";
import type { SoqlResultDto, QueryPlanDto } from "../types";
import type { SoqlTab } from "../tabs/types";

/** Warn before fetching an unconstrained query larger than this (rows). */
const LARGE_THRESHOLD = 5000;
/** Row cap injected when the user picks "Add LIMIT" from the large-query prompt. */
const PREVIEW_LIMIT = 2000;

interface SoqlViewProps {
  tab: SoqlTab;
  onPatch: (partial: Partial<SoqlTab>) => void;
  onSave?: () => void;
  reveal?: Reveal;
}

/** SOQL tool (single tab): editor on top, Table/Tree result toggle + status line below. */
export function SoqlView({ tab, onPatch, onSave, reveal }: SoqlViewProps) {
  const { query, result, error, view, useToolingApi, allRows, plan, lastMs } =
    tab;
  const [running, setRunning] = useState(false);
  // True while the pre-flight COUNT() is in flight (before the real query).
  const [counting, setCounting] = useState(false);
  // Set when a no-LIMIT query would return more than LARGE_THRESHOLD rows; holds
  // the count for the confirm dialog.
  const [largeConfirm, setLargeConfirm] = useState<{ count: number } | null>(null);
  // Live pagination progress for the in-flight query (fetched / totalSize).
  const [progress, setProgress] = useState<{ fetched: number; total: number } | null>(
    null,
  );
  const queryIdRef = useRef<string | null>(null);
  // Set by Cancel during the pre-flight count so the run aborts after it returns.
  const abortedRef = useRef(false);
  const startRef = useRef(0);
  const { selected: org } = useOrgs();
  // Persist the editor/results split to localStorage; restored on next launch.
  // First run falls back to the editor's ~5-line default size below.
  const layout = useDefaultLayout({
    id: "uf-soql-split",
    panelIds: ["editor", "results"],
    storage: localStorage,
  });

  const execute = useCallback(
    async (q: string) => {
      setRunning(true);
      setProgress(null);
      onPatch({ error: null });
      const queryId = crypto.randomUUID();
      queryIdRef.current = queryId;
      startRef.current = performance.now();
      const t0 = startRef.current;
      // Stream pagination progress for THIS query (ignore other tabs' events).
      const unlisten = await listen<{ id: string; fetched: number; total: number }>(
        "soql-progress",
        (e) => {
          if (e.payload.id === queryId)
            setProgress({ fetched: e.payload.fetched, total: e.payload.total });
        },
      );
      try {
        const dto = await invoke<SoqlResultDto>("run_soql", {
          query: q,
          useToolingApi,
          allRows,
          queryId,
        });
        const ms = performance.now() - t0;
        onPatch({ result: dto, lastMs: ms });
        if (!dto.done)
          toast.info(`Cancelled — showing ${dto.rows.length.toLocaleString()} rows`);
        void timing("run.soql", ms);
        void recordHistory({
          tool: "soql",
          org,
          text: q,
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
          text: q,
          status: "error",
          durationMs: ms,
        });
      } finally {
        unlisten();
        queryIdRef.current = null;
        setProgress(null);
        setRunning(false);
      }
    },
    [onPatch, org, useToolingApi, allRows],
  );

  const run = useCallback(async () => {
    if (!query.trim()) {
      toast.error("Write a query to run");
      return;
    }
    // Pre-flight: warn before fetching an unconstrained, very large result set
    // (mirrors Illuminated Cloud's COUNT() guard). Best-effort — never blocks a
    // run if the count fails. Cancellable: shares the query id / cancel registry.
    const countId = crypto.randomUUID();
    queryIdRef.current = countId;
    abortedRef.current = false;
    setCounting(true);
    let count: number | null = null;
    try {
      count = await invoke<number | null>("count_soql", {
        query,
        useToolingApi,
        queryId: countId,
      });
    } catch {
      count = null;
    } finally {
      setCounting(false);
      queryIdRef.current = null;
    }
    if (abortedRef.current) return; // cancelled during the size check
    if (count != null && count > LARGE_THRESHOLD) {
      setLargeConfirm({ count });
      return;
    }
    await execute(query);
  }, [query, useToolingApi, execute]);

  const cancel = useCallback(() => {
    abortedRef.current = true;
    if (queryIdRef.current)
      void invoke("cancel_soql", { queryId: queryIdRef.current });
  }, []);

  const explain = useCallback(async () => {
    try {
      const dto = await invoke<QueryPlanDto>("query_plan", { query });
      onPatch({ plan: dto });
    } catch (e) {
      const message = typeof e === "string" ? e : String(e);
      toast.error(parseSfError(message).detail);
    }
  }, [query, onPatch]);

  const ms = lastMs != null ? ` · ${Math.round(lastMs)} ms` : "";
  const status = error
    ? "error"
    : result
      ? result.done
        ? `${result.total_size} row${result.total_size === 1 ? "" : "s"} returned${ms}`
        : `${result.rows.length.toLocaleString()} of ${result.total_size.toLocaleString()} rows · cancelled${ms}`
      : "";

  // Rough ETA from the rows/sec measured so far. Recomputed each progress tick.
  const eta = (() => {
    if (!progress || progress.fetched <= 0 || progress.total <= progress.fetched)
      return null;
    const elapsed = (performance.now() - startRef.current) / 1000;
    const rate = progress.fetched / elapsed;
    if (!isFinite(rate) || rate <= 0) return null;
    const secs = (progress.total - progress.fetched) / rate;
    return secs < 1 ? "<1s" : secs < 60 ? `${Math.round(secs)}s` : `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  })();
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.fetched / progress.total) * 100))
      : null;

  return (
    <>
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
          onSave={onSave}
          running={running || counting}
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
              <label
                className="flex cursor-pointer items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-foreground"
                title="Include deleted/archived rows (queryAll, --all-rows)"
              >
                <input
                  type="checkbox"
                  checked={allRows}
                  onChange={(e) => onPatch({ allRows: e.target.checked })}
                  className="size-3 cursor-pointer accent-primary"
                />
                All rows
              </label>
              <button
                type="button"
                onClick={() => void explain()}
                title="EXPLAIN: show the query plan (cost, cardinality, leading operation)"
                className="focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-foreground"
              >
                Explain
              </button>
            </div>
            {running || counting ? (
              <div className="flex items-center gap-2 text-[11px] text-text-dim">
                {counting ? (
                  <span className="tnum">Checking size…</span>
                ) : progress && progress.total > 0 ? (
                  <>
                    <span className="tnum">
                      {progress.fetched.toLocaleString()} /{" "}
                      {progress.total.toLocaleString()}
                      {pct != null ? ` · ${pct}%` : ""}
                      {eta ? ` · ETA ${eta}` : ""}
                    </span>
                    <span className="h-1 w-20 overflow-hidden rounded-full bg-border">
                      <span
                        className="block h-full bg-primary transition-[width] duration-300"
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </span>
                  </>
                ) : (
                  <span className="tnum">Executing…</span>
                )}
                <button
                  type="button"
                  onClick={cancel}
                  className="focus-accent cursor-pointer rounded-md border border-border px-2 py-0.5 uppercase tracking-wide text-text-dim transition-colors hover:border-destructive hover:text-destructive"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <span className="tnum text-[11px] text-text-dim">{status}</span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {plan ? (
              <QueryPlanView plan={plan} onClose={() => onPatch({ plan: null })} />
            ) : error && isCliUnavailable(error) ? (
              <CliGuidanceForError onRetry={run} />
            ) : error ? (
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

    <Dialog
      open={largeConfirm != null}
      onOpenChange={(o) => !o && setLargeConfirm(null)}
    >
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>Large result set</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-dim">
          This query has no <code>LIMIT</code> and would return about{" "}
          <span className="font-medium text-foreground">
            {largeConfirm?.count.toLocaleString()}
          </span>{" "}
          rows — more than the {LARGE_THRESHOLD.toLocaleString()} row guard.
          Fetching them all may be slow.
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => setLargeConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setLargeConfirm(null);
              void execute(`${query}\nLIMIT ${PREVIEW_LIMIT}`);
            }}
          >
            Add LIMIT {PREVIEW_LIMIT.toLocaleString()}
          </Button>
          <Button
            onClick={() => {
              setLargeConfirm(null);
              void execute(query);
            }}
          >
            Run anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
