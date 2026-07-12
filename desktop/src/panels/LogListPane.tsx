import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  RefreshCw,
  Loader2,
  HardDriveDownload,
  Search,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fmtDuration, fmtSize, fmtTime, type LogFilter } from "./logList";
import type { useSelfTrace } from "./useSelfTrace";
import type { LogRefDto } from "../types";

function isSuccess(status: string): boolean {
  return status.toLowerCase() === "success";
}

/** Left-hand list pane: toolbar (refresh / logging config / self-trace), text
 * filter, the virtualized log list, and the drag-drop overlay. */
// fallow-ignore-next-line complexity
export function LogListPane({
  logs,
  visibleLogs,
  listError,
  listLoading,
  filter,
  setFilter,
  selectedId,
  cachedIds,
  dragOver,
  trace,
  onRefresh,
  onOpenConfig,
  onSelect,
  onSaveLog,
}: {
  logs: LogRefDto[];
  visibleLogs: LogRefDto[];
  listError: string | null;
  listLoading: boolean;
  filter: LogFilter;
  setFilter: React.Dispatch<React.SetStateAction<LogFilter>>;
  selectedId: string | null;
  cachedIds: Set<string>;
  dragOver: boolean;
  trace: ReturnType<typeof useSelfTrace>;
  onRefresh: () => void;
  onOpenConfig: () => void;
  onSelect: (id: string) => void;
  onSaveLog: (log: LogRefDto) => void;
}) {
  const { tracing, tracingBusy, traceExpiry, traceMinsLeft, quickSelfTrace } = trace;

  // Virtualize the log list — it can run to thousands of rows.
  const listParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: visibleLogs.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 57,
    overscan: 10,
  });

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="micro-label flex-1">Logs</div>
        <Button
          variant="ghost"
          size="sm"
          label="Refresh"
          icon={
            listLoading ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <RefreshCw size={12} />
            )
          }
          onClick={onRefresh}
          isDisabled={listLoading}
          className="h-7 cursor-pointer gap-1 px-1.5 text-[11px] text-text-dim hover:text-foreground"
        />
        <Button
          variant="ghost"
          size="sm"
          label="Logging"
          aria-label="Configure logging"
          icon={<SlidersHorizontal size={12} />}
          onClick={onOpenConfig}
          className="h-7 cursor-pointer gap-1 px-1.5 text-[11px] text-text-dim hover:text-foreground"
        />
        <Button
          variant="ghost"
          size="sm"
          label={tracing ? `Tracing · ${traceMinsLeft}m` : "Set My Trace"}
          aria-label={
            tracing
              ? `Tracing you — ${traceMinsLeft} min left; click to extend`
              : "Trace myself for 30 minutes"
          }
          tooltip={
            tracing
              ? `Traced until ${new Date(traceExpiry!).toLocaleTimeString()} — click to extend 30 min`
              : "Trace yourself for 30 minutes"
          }
          icon={
            tracingBusy ? (
              <Loader2 size={12} className="spin" />
            ) : tracing ? (
              <span className="size-2 rounded-full bg-primary animate-pulse" />
            ) : (
              <Timer size={12} />
            )
          }
          onClick={quickSelfTrace}
          isDisabled={tracingBusy}
          className={`h-7 cursor-pointer gap-1 px-1.5 text-[11px] hover:text-foreground ${
            tracing ? "text-primary" : "text-text-dim"
          }`}
        />
      </div>

      {logs.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <div className="flex-1">
            <TextInput
              label="Filter logs"
              isLabelHidden
              value={filter.query}
              onChange={(value) =>
                setFilter((f) => ({ ...f, query: value }))
              }
              placeholder="Filter operation / user"
              size="sm"
              startIcon={<Search size={12} />}
              width="100%"
              className="text-[12px]"
            />
          </div>
        </div>
      )}

      {listError ? (
        <pre className="m-4 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-card p-3 text-[12px] text-destructive">
          {listError}
        </pre>
      ) : logs.length === 0 && !listLoading ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-muted-foreground">
          <span>No debug logs yet. Set a trace flag, then refresh to fetch them.</span>
          <button
            type="button"
            onClick={onRefresh}
            className="focus-accent cursor-pointer rounded-md border border-border px-3 py-1 text-[12px] text-foreground transition-colors hover:border-primary hover:text-primary"
          >
            Refresh
          </button>
        </div>
      ) : visibleLogs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-muted-foreground">
          <span>No logs match this filter.</span>
          <button
            type="button"
            onClick={() => setFilter((f) => ({ ...f, query: "" }))}
            className="focus-accent cursor-pointer rounded-md border border-border px-3 py-1 text-[12px] text-foreground transition-colors hover:border-primary hover:text-primary"
          >
            Clear filter
          </button>
        </div>
      ) : (
        <div ref={listParentRef} className="uf-scroll min-h-0 flex-1 overflow-y-auto">
          <div
            style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
          >
            {rowVirtualizer.getVirtualItems().map(
              // fallow-ignore-next-line complexity
              (vi) => {
              const log = visibleLogs[vi.index];
              const ok = isSuccess(log.status);
              const selected = log.id === selectedId;
              const cached = cachedIds.has(log.id);
              const time = fmtTime(log.startTime);
              return (
                <ContextMenu key={log.id}>
                  <ContextMenuTrigger asChild>
                    <button
                      data-index={vi.index}
                      ref={rowVirtualizer.measureElement}
                      type="button"
                      onClick={() => onSelect(log.id)}
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
                          <span className="shrink-0">
                            <Badge
                              variant={ok ? "success" : "error"}
                              label={ok ? "Success" : "Failed"}
                              className="px-1.5 py-0 text-[10px]"
                            />
                          </span>
                        </div>
                        <div className="tnum flex w-full items-center gap-2 font-mono text-[10px] text-text-dim">
                          {log.user && (
                            <span className="max-w-[45%] truncate">{log.user}</span>
                          )}
                          <span>{fmtDuration(log.durationMs)}</span>
                          <span>{fmtSize(log.logLength)}</span>
                          {time && <span className="ml-auto">{time}</span>}
                        </div>
                      </div>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => onSaveLog(log)}>
                      Save log…
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
              },
            )}
          </div>
        </div>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-primary/40 bg-background/80">
          <span className="text-[12px] font-medium text-text-dim">
            Drop a .log file to view
          </span>
        </div>
      )}
    </div>
  );
}
