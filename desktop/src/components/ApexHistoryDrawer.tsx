import { useEffect, useState } from "react";
import { Trash2, X, ChevronLeft, Copy, FileInput } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { useOverlayExit } from "../hooks/useOverlayExit";
import { copyText } from "../clipboard";
import { LogView } from "./LogView";
import {
  clearApexHistory,
  listApexHistory,
  onApexHistory,
  type ApexHistoryEntry,
} from "../apexHistory";

function relTime(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(at).toLocaleDateString();
}

/** First non-empty line of the source, for the list preview. */
function firstLine(src: string): string {
  return src.split("\n").find((l) => l.trim() !== "") ?? "(empty)";
}

function statusLabel(e: ApexHistoryEntry): string {
  if (!e.compiled) return "Compile error";
  return e.success ? "Success" : "Failed";
}

function StatusBadge({ e }: { e: ApexHistoryEntry }) {
  return (
    <Badge
      variant={e.compiled && e.success ? "success" : "error"}
      label={statusLabel(e)}
      className="text-[11px]"
    />
  );
}

/** Newest-first list of past runs; each row opens its detail. */
// fallow-ignore-next-line complexity
function HistoryList({
  entries,
  onSelect,
}: {
  entries: ApexHistoryEntry[];
  onSelect: (id: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        No runs yet
      </div>
    );
  }
  return (
    <ul>
      {entries.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onSelect(e.id)}
            className="focus-accent flex w-full cursor-pointer flex-col gap-1 border-b border-border/60 px-4 py-2 text-left hover:bg-accent/60"
          >
            <div className="flex items-center gap-2">
              <StatusBadge e={e} />
              <span className="tnum ml-auto text-[11px] text-muted-foreground">
                {relTime(e.at)}
              </span>
            </div>
            <code className="line-clamp-2 break-all font-mono text-[11px] text-muted-foreground">
              {firstLine(e.source)}
            </code>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One past run: status, source, and its debug log; can copy/load the source. */
// fallow-ignore-next-line complexity
function HistoryDetail({
  entry,
  onLoad,
}: {
  entry: ApexHistoryEntry;
  onLoad: (source: string) => void;
}) {
  return (
    <div className="select-text flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center gap-2">
        <StatusBadge e={entry} />
        <span className="tnum text-[11px] text-muted-foreground">
          {relTime(entry.at)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copyText(entry.source, "Source copied")}
            className="focus-accent inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:border-primary cursor-pointer"
          >
            <Copy size={12} /> Copy
          </button>
          <button
            type="button"
            onClick={() => onLoad(entry.source)}
            className="focus-accent inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:border-primary cursor-pointer"
          >
            <FileInput size={12} /> Load
          </button>
        </span>
      </div>

      {entry.exceptionMessage && (
        <div className="rounded-md border border-destructive/40 bg-background p-2 text-[12px] text-destructive">
          {entry.exceptionMessage}
        </div>
      )}

      <div>
        <div className="micro-label pb-1">Source</div>
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] text-foreground">
          {entry.source}
        </pre>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="micro-label pb-1">Debug log</div>
        {entry.logs ? (
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <LogView raw={entry.logs} />
          </div>
        ) : (
          <div className="rounded-md border border-border p-2 text-[13px] text-muted-foreground">
            No debug log
          </div>
        )}
      </div>
    </div>
  );
}

interface ApexHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Load a past run's source into the active editor. */
  onLoad: (source: string) => void;
}

/** Right-side drawer of past anonymous-Apex runs: source + debug log, viewable. */
// fallow-ignore-next-line complexity
export function ApexHistoryDrawer({
  open,
  onOpenChange,
  onLoad,
}: ApexHistoryDrawerProps) {
  const [entries, setEntries] = useState<ApexHistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Keep the drawer mounted through its slide-out so close is symmetric.
  const { mounted, exiting, onAnimationEnd } = useOverlayExit(open, {
    exitName: "fjord-drawer-out",
    exitMs: 120,
  });

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    void listApexHistory().then(setEntries);
    return onApexHistory(setEntries);
  }, [open]);

  // Close on Escape (custom drawer, not a Radix dialog).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!mounted) return null;

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-label="Apex execution history"
      data-motion-phase={exiting ? "exit" : undefined}
      onAnimationEnd={onAnimationEnd}
    >
      <div
        className="fjord-drawer-scrim absolute inset-0 bg-black/20"
        onClick={() => onOpenChange(false)}
      />
      <aside className="fjord-drawer-panel relative flex h-full w-[520px] flex-col border-l border-border bg-card shadow-xl">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          {selected ? (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="focus-accent inline-flex items-center gap-1 cursor-pointer text-text-dim hover:text-foreground"
            >
              <ChevronLeft size={14} />
              <span className="micro-label">Back</span>
            </button>
          ) : (
            <span className="micro-label">Apex history</span>
          )}
          <div className="flex items-center gap-1">
            {!selected && entries.length > 0 && (
              <button
                type="button"
                aria-label="Clear history"
                onClick={() => void clearApexHistory()}
                className="focus-accent cursor-pointer rounded-md p-1 text-text-dim hover:text-destructive"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              type="button"
              aria-label="Close history"
              onClick={() => onOpenChange(false)}
              className="focus-accent cursor-pointer rounded-md p-1 text-text-dim hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {selected ? (
          <HistoryDetail
            entry={selected}
            onLoad={(source) => {
              onLoad(source);
              onOpenChange(false);
            }}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <HistoryList entries={entries} onSelect={setSelectedId} />
          </div>
        )}
      </aside>
    </div>
  );
}
