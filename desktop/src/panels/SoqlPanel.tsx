import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@astryxdesign/core/Button";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { MotionDialog } from "../components/motion/MotionDialog";
import { SoqlEditor } from "../components/SoqlEditor";
import type { Reveal } from "../editor/monaco-reveal";
import { ResultTable } from "../components/ResultTable";
import { QueryPlanView } from "../components/QueryPlanView";
import { LogoLoader } from "../components/LogoLoader";
import { useOrgs } from "../org";
import { useArrivalCue } from "../hooks/useArrivalCue";
import { cancelSoql, countSoql, queryPlan, runSoql } from "../ipc/soql";
import { parseSfError, isCliUnavailable, formatIpcError } from "../errorFormat";
import { CliGuidanceForError } from "../components/CliGuidance";
import { SfErrorDetail } from "../components/SfErrorDetail";
import type { SoqlTab } from "../tabs/types";
import { useI18n } from "../i18n";

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

interface QueryRequest {
  owner: RequestScope;
  active: boolean;
  aborted: boolean;
  id: string | null;
  unlisten: (() => void) | null;
  query: string;
  useToolingApi: boolean;
  allRows: boolean;
}

interface RequestScope {
  key: symbol;
  active: boolean;
  query: QueryRequest | null;
  plan: object | null;
}

interface RequestUi {
  running: boolean;
  counting: boolean;
  explaining: boolean;
  largeConfirm: { count: number; request: QueryRequest } | null;
  progress: { fetched: number; total: number } | null;
}

const idleRequests: RequestUi = {
  running: false, counting: false, explaining: false, largeConfirm: null, progress: null,
};

function releaseQuery(request: QueryRequest, cancel: boolean) {
  request.active = false;
  request.unlisten?.();
  request.unlisten = null;
  if (cancel && request.id && !request.aborted) {
    request.aborted = true;
    // Disposal is silent; a late cancel failure must not notify another view. / 销毁静默处理，迟到的取消失败不通知其他视图。
    void cancelSoql(request.id).catch(() => {});
  }
}

/** Scope requests independently of editor lifetime. / 请求归属独立于编辑器生命周期。 */
export function SoqlView({ tab, onPatch, onSave, reveal }: SoqlViewProps) {
  const { selected: org } = useOrgs();
  const { locale, t } = useI18n();
  const { query, result, error, useToolingApi, allRows, plan, lastMs } = tab;
  const scope = useMemo(() => Symbol(), [org, tab.id]);
  const ownerRef = useRef<RequestScope | null>(null);
  const [requestUi, setRequestUi] = useState<RequestUi & { scope: symbol }>(() => ({ ...idleRequests, scope }));
  // Hide a previous scope's transient UI immediately without resetting the editor. / 立即隐藏上一归属的临时界面，不重置编辑器。
  const { running, counting, explaining, largeConfirm, progress } = requestUi.scope === scope ? requestUi : idleRequests;
  const patchUi = useCallback((patch: Partial<RequestUi>) => {
    if (!ownerRef.current?.active || ownerRef.current.key !== scope) return;
    setRequestUi((previous) => ({ ...(previous.scope === scope ? previous : idleRequests), ...patch, scope }));
  }, [scope]);
  const startRef = useRef(0);
  useLayoutEffect(() => {
    const owner: RequestScope = { key: scope, active: true, query: null, plan: null };
    ownerRef.current = owner;
    return () => {
      owner.active = false;
      if (owner.query) releaseQuery(owner.query, true);
      owner.query = null;
      owner.plan = null;
    };
  }, [scope]);
  // Persist the editor/results split to localStorage; restored on next launch.
  // First run falls back to the editor's ~5-line default size below.
  const layout = useDefaultLayout({
    id: "uf-soql-split",
    panelIds: ["editor", "results"],
    storage: localStorage,
  });

  const execute = useCallback(
    async (request: QueryRequest, q = request.query) => {
      const owner = request.owner;
      const current = () => owner.active && ownerRef.current === owner && request.active && owner.query === request;
      if (!current() || request.aborted) return;
      patchUi({ running: true, progress: null });
      onPatch({ error: null });
      const queryId = crypto.randomUUID();
      request.id = queryId;
      startRef.current = performance.now();
      const t0 = startRef.current;
      try {
        // Registration is owned too: disposal can happen before its promise resolves. / 注册也有归属：其 Promise 完成前视图可能已销毁。
        const unlisten = await listen<{ id: string; fetched: number; total: number }>(
          "soql-progress",
          (e) => {
            if (current() && e.payload.id === queryId)
              patchUi({ progress: { fetched: e.payload.fetched, total: e.payload.total } });
          },
        );
        if (!current() || request.aborted) {
          unlisten();
          return;
        }
        request.unlisten = unlisten;
        const dto = await runSoql({
          query: q,
          useToolingApi: request.useToolingApi,
          allRows: request.allRows,
          queryId,
          org,
        });
        if (!current()) return;
        const ms = performance.now() - t0;
        onPatch({ result: dto, lastMs: ms });
        if (!dto.done)
          toast.info(t("Cancelled — showing {count} rows", { count: dto.rows.length.toLocaleString(locale) }));
      } catch (e) {
        if (!current()) return;
        const message = formatIpcError(e);
        toast.error(parseSfError(message).detail);
        onPatch({ error: message });
      } finally {
        const owned = current();
        releaseQuery(request, false);
        if (owned) {
          owner.query = null;
          patchUi({ progress: null, running: false });
        }
      }
    },
    [onPatch, org, locale, t, patchUi],
  );

  const run = useCallback(async () => {
    const owner = ownerRef.current;
    if (!owner?.active || owner.key !== scope || owner.query) return;
    if (!query.trim()) {
      toast.error(t("Write a query to run"));
      return;
    }
    // Pre-flight: warn before fetching an unconstrained, very large result set
    // (mirrors Illuminated Cloud's COUNT() guard). Best-effort — never blocks a
    // run if the count fails. Cancellable: shares the query id / cancel registry.
    const countId = crypto.randomUUID();
    const request: QueryRequest = {
      owner, active: true, aborted: false, id: countId, unlisten: null,
      query, useToolingApi, allRows,
    };
    owner.query = request;
    const current = () => owner.active && ownerRef.current === owner && request.active && owner.query === request;
    patchUi({ counting: true });
    let count: number | null = null;
    try {
      count = await countSoql({
        query,
        useToolingApi,
        queryId: countId,
        org,
      });
    } catch {
      count = null;
    } finally {
      request.id = null;
      if (current()) patchUi({ counting: false });
    }
    if (!current()) return;
    if (request.aborted) {
      releaseQuery(request, false);
      owner.query = null;
      return;
    }
    if (count != null && count > LARGE_THRESHOLD) {
      patchUi({ largeConfirm: { count, request } });
      return;
    }
    await execute(request);
  }, [query, useToolingApi, allRows, org, execute, t, scope, patchUi]);

  const cancel = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner || owner.key !== scope) return;
    const request = owner.query;
    if (!request || request.aborted) return;
    request.aborted = true;
    if (request.id) void cancelSoql(request.id).catch((error: unknown) => {
      if (owner.active && ownerRef.current === owner && owner.query === request && request.active) {
        request.aborted = false;
        toast.error(parseSfError(formatIpcError(error)).detail);
      }
    });
  }, [scope]);

  const dismissLarge = useCallback(() => {
    if (largeConfirm) {
      releaseQuery(largeConfirm.request, false);
      const owner = largeConfirm.request.owner;
      if (owner.query === largeConfirm.request) owner.query = null;
    }
    patchUi({ largeConfirm: null });
  }, [largeConfirm, patchUi]);

  const explain = useCallback(async () => {
    const owner = ownerRef.current;
    if (!owner?.active || owner.key !== scope || owner.plan) return;
    const request = {};
    owner.plan = request;
    patchUi({ explaining: true });
    try {
      const dto = await queryPlan(query, org);
      if (!owner.active || ownerRef.current !== owner || owner.plan !== request) return;
      onPatch({ plan: dto });
    } catch (e) {
      if (!owner.active || ownerRef.current !== owner || owner.plan !== request) return;
      const message = formatIpcError(e);
      toast.error(parseSfError(message).detail);
    } finally {
      if (owner.active && ownerRef.current === owner && owner.plan === request) {
        owner.plan = null;
        patchUi({ explaining: false });
      }
    }
  }, [query, org, onPatch, scope, patchUi]);

  const ms = lastMs != null
    ? ` · ${t("{milliseconds} ms", { milliseconds: Math.round(lastMs).toLocaleString(locale) })}`
    : "";
  const status = error
    ? t("error")
    : result
      ? result.done
        ? t(result.totalSize === 1 ? "{count} row returned" : "{count} rows returned", {
            count: result.totalSize.toLocaleString(locale),
          }) + ms
        : t("{fetched} of {total} rows · cancelled", {
            fetched: result.rows.length.toLocaleString(locale), total: result.totalSize.toLocaleString(locale),
          }) + ms
      : "";

  // Rough ETA from the rows/sec measured so far. Recomputed each progress tick.
  const eta = (() => {
    if (!progress || progress.fetched <= 0 || progress.total <= progress.fetched)
      return null;
    const elapsed = (performance.now() - startRef.current) / 1000;
    const rate = progress.fetched / elapsed;
    if (!isFinite(rate) || rate <= 0) return null;
    const secs = (progress.total - progress.fetched) / rate;
    return secs < 1 ? t("<1s") : secs < 60
      ? t("{seconds}s", { seconds: Math.round(secs).toLocaleString(locale) })
      : t("{minutes}m {seconds}s", {
          minutes: Math.floor(secs / 60).toLocaleString(locale), seconds: Math.round(secs % 60).toLocaleString(locale),
        });
  })();
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.fetched / progress.total) * 100))
      : null;

  // One-shot success cue: increments only when a NEW fully-fetched result lands
  // (not on cancel/error, not on scroll/sort/filter, which never change `result`
  // identity). Drives the results scan and the status-line bloom.
  const succeeded = !error && result != null && result.done;
  const arrivalNonce = useArrivalCue(succeeded ? result : null);

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
          useToolingApi={useToolingApi}
          onToggleToolingApi={() => onPatch({ useToolingApi: !useToolingApi })}
          allRows={allRows}
          onToggleAllRows={() => onPatch({ allRows: !allRows })}
        />
      </ResizablePanel>
      <ResizableHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />
      <ResizablePanel id="results" minSize="160px">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
            {/* Result views only. Run options (Tooling API / All rows) live on the
                editor toolbar beside Run — they change the next run, not this view. */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void explain()}
                disabled={explaining}
                aria-pressed={plan != null}
                className={`focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[12px] transition-colors disabled:opacity-60 ${
                  plan != null || explaining
                    ? "bg-primary/15 text-primary"
                    : "text-text-dim hover:text-foreground"
                }`}
              >
                {t("Explain")}
              </button>
            </div>
            {running || counting ? (
              <div className="flex items-center gap-2 text-[11px] text-text-dim">
                {counting ? (
                  <span className="tnum">{t("Checking size…")}</span>
                ) : progress && progress.total > 0 ? (
                  <>
                    <span className="tnum">
                      {progress.fetched.toLocaleString(locale)} /{" "}
                      {progress.total.toLocaleString(locale)}
                      {pct != null ? ` · ${pct}%` : ""}
                      {eta ? ` · ${t("ETA {time}", { time: eta })}` : ""}
                    </span>
                    <span className="h-1 w-20 overflow-hidden rounded-full bg-border">
                      <span
                        className="fjord-progress-fill block h-full bg-primary"
                        style={
                          { "--progress": (pct ?? 0) / 100 } as CSSProperties
                        }
                      />
                    </span>
                  </>
                ) : (
                  <span className="tnum">{t("Executing…")}</span>
                )}
                <button
                  type="button"
                  onClick={cancel}
                  className="focus-accent cursor-pointer rounded-md border border-border px-2 py-0.5 text-text-dim transition-colors hover:border-destructive hover:text-destructive"
                >
                  {t("Cancel")}
                </button>
              </div>
            ) : (
              <span
                key={arrivalNonce}
                className={`tnum text-[11px] text-text-dim ${
                  succeeded && arrivalNonce > 0 ? "fjord-status-bloom" : ""
                }`}
              >
                {status}
              </span>
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
                {t("Run a query to see results")}
              </div>
            ) : (
              <ResultTable data={result} query={query} arrivalNonce={arrivalNonce} />
            )}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>

    <MotionDialog
      isOpen={largeConfirm != null}
      onOpenChange={(o) => !o && dismissLarge()}
      width={480}
    >
      <DialogHeader
        title={t("Large result set")}
        onOpenChange={(o) => !o && dismissLarge()}
      />
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-dim">
          {t("This query has no")} <code>LIMIT</code>{locale === "en" ? " " : ""}{t("and would return about")}{" "}
          <span className="font-medium text-foreground">
            {largeConfirm?.count.toLocaleString(locale)}
          </span>{" "}
          {t("rows — more than the {threshold} row guard. Fetching them all may be slow.", {
            threshold: LARGE_THRESHOLD.toLocaleString(locale),
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            label={t("Cancel")}
            variant="ghost"
            onClick={dismissLarge}
          />
          <Button
            label={t("Add LIMIT {count}", { count: PREVIEW_LIMIT.toLocaleString(locale) })}
            variant="secondary"
            onClick={() => {
              if (!largeConfirm) return;
              patchUi({ largeConfirm: null });
              void execute(largeConfirm.request, `${largeConfirm.request.query}\nLIMIT ${PREVIEW_LIMIT}`);
            }}
          />
          <Button
            label={t("Run anyway")}
            onClick={() => {
              if (!largeConfirm) return;
              patchUi({ largeConfirm: null });
              void execute(largeConfirm.request);
            }}
          />
        </div>
      </div>
    </MotionDialog>
    </>
  );
}
