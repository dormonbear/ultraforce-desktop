import { useCallback, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { SoqlEditor } from "../components/SoqlEditor";
import type { Reveal } from "../editor/monaco-reveal";
import { ResultTable } from "../components/ResultTable";
import { QueryPlanView } from "../components/QueryPlanView";
import { LogoLoader } from "../components/LogoLoader";
import { useOrgs } from "../org";
import { cancelSoql, countSoql, queryPlan, runSoql } from "../ipc/soql";
import { parseSfError, isCliUnavailable, formatIpcError } from "../errorFormat";
import { CliGuidanceForError } from "../components/CliGuidance";
import { SfErrorDetail } from "../components/SfErrorDetail";
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
  const { query, result, error, useToolingApi, allRows, plan, lastMs } = tab;
  const [running, setRunning] = useState(false);
  // True while the pre-flight COUNT() is in flight (before the real query).
  const [counting, setCounting] = useState(false);
  // True while the Explain query-plan request is in flight.
  const [explaining, setExplaining] = useState(false);
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
        const dto = await runSoql({
          query: q,
          useToolingApi,
          allRows,
          queryId,
        });
        const ms = performance.now() - t0;
        onPatch({ result: dto, lastMs: ms });
        if (!dto.done)
          toast.info(`Cancelled — showing ${dto.rows.length.toLocaleString()} rows`);
      } catch (e) {
        const message = formatIpcError(e);
        toast.error(parseSfError(message).detail);
        onPatch({ error: message });
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
      count = await countSoql({
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
      void cancelSoql(queryIdRef.current);
  }, []);

  const explain = useCallback(async () => {
    setExplaining(true);
    try {
      const dto = await queryPlan(query);
      onPatch({ plan: dto });
    } catch (e) {
      const message = formatIpcError(e);
      toast.error(parseSfError(message).detail);
    } finally {
      setExplaining(false);
    }
  }, [query, onPatch]);

  const ms = lastMs != null ? ` · ${Math.round(lastMs)} ms` : "";
  const status = error
    ? "error"
    : result
      ? result.done
        ? `${result.totalSize} row${result.totalSize === 1 ? "" : "s"} returned${ms}`
        : `${result.rows.length.toLocaleString()} of ${result.totalSize.toLocaleString()} rows · cancelled${ms}`
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
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void explain()}
                disabled={explaining}
                aria-pressed={plan != null}
                title="Show the query plan (cost, cardinality, leading operation)"
                className={`focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[12px] transition-colors disabled:opacity-60 ${
                  plan != null || explaining
                    ? "bg-primary/15 text-primary"
                    : "text-text-dim hover:text-foreground"
                }`}
              >
                Explain
              </button>
              <button
                type="button"
                aria-pressed={useToolingApi}
                onClick={() => onPatch({ useToolingApi: !useToolingApi })}
                title="Query via the Tooling API"
                className={`focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[12px] transition-colors ${
                  useToolingApi
                    ? "bg-primary/15 text-primary"
                    : "text-text-dim hover:text-foreground"
                }`}
              >
                Tooling API
              </button>
              <button
                type="button"
                aria-pressed={allRows}
                onClick={() => onPatch({ allRows: !allRows })}
                title="Include deleted/archived rows (ALL ROWS)"
                className={`focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[12px] transition-colors ${
                  allRows
                    ? "bg-primary/15 text-primary"
                    : "text-text-dim hover:text-foreground"
                }`}
              >
                All rows
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
                  className="focus-accent cursor-pointer rounded-md border border-border px-2 py-0.5 text-text-dim transition-colors hover:border-destructive hover:text-destructive"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <span className="tnum text-[11px] text-text-dim">{status}</span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {explaining ? (
              <div className="flex h-full items-center justify-center">
                <LogoLoader size={44} />
              </div>
            ) : plan ? (
              <QueryPlanView plan={plan} onClose={() => onPatch({ plan: null })} />
            ) : error && isCliUnavailable(error) ? (
              <CliGuidanceForError onRetry={run} />
            ) : error ? (
              <SfErrorDetail error={error} className="m-4" />
            ) : !result ? (
              <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
                Run a query to see results
              </div>
            ) : (
              <ResultTable data={result} query={query} />
            )}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>

    <Dialog
      isOpen={largeConfirm != null}
      onOpenChange={(o) => !o && setLargeConfirm(null)}
      width={480}
    >
      <DialogHeader
        title="Large result set"
        onOpenChange={(o) => !o && setLargeConfirm(null)}
      />
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-dim">
          This query has no <code>LIMIT</code> and would return about{" "}
          <span className="font-medium text-foreground">
            {largeConfirm?.count.toLocaleString()}
          </span>{" "}
          rows — more than the {LARGE_THRESHOLD.toLocaleString()} row guard.
          Fetching them all may be slow.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            label="Cancel"
            variant="ghost"
            onClick={() => setLargeConfirm(null)}
          />
          <Button
            label={`Add LIMIT ${PREVIEW_LIMIT.toLocaleString()}`}
            variant="secondary"
            onClick={() => {
              setLargeConfirm(null);
              void execute(`${query}\nLIMIT ${PREVIEW_LIMIT}`);
            }}
          />
          <Button
            label="Run anyway"
            onClick={() => {
              setLargeConfirm(null);
              void execute(query);
            }}
          />
        </div>
      </div>
    </Dialog>
    </>
  );
}
