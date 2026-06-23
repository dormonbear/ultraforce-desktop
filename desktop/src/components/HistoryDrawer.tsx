import { useEffect, useMemo, useState } from "react";
import { Trash2, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  clearHistory,
  listHistory,
  onHistory,
  type HistoryEntry,
} from "../history";
import { requestOpenTab } from "../openTab";

function relTime(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(at).toLocaleDateString();
}

interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Right-side drawer listing recent runs; clicking one re-opens it in a tab. */
export function HistoryDrawer({ open, onOpenChange }: HistoryDrawerProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ("");
    void listHistory().then(setEntries);
    return onHistory(setEntries);
  }, [open]);

  // Close on Escape (this is a custom drawer, not a Radix dialog).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        e.text.toLowerCase().includes(needle) ||
        e.tool.toLowerCase().includes(needle),
    );
  }, [entries, q]);

  if (!open) return null;

  const pick = (e: HistoryEntry) => {
    requestOpenTab(e.tool, e.text);
    onOpenChange(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Run history">
      <div
        className="absolute inset-0 bg-black/20"
        onClick={() => onOpenChange(false)}
      />
      <aside className="relative flex h-full w-[380px] flex-col border-l border-border bg-card shadow-xl">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="micro-label">RUN HISTORY</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Clear history"
              onClick={() => void clearHistory()}
              className="focus-accent cursor-pointer rounded-md p-1 text-text-dim hover:text-destructive"
            >
              <Trash2 size={14} />
            </button>
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
        {entries.length > 0 && (
          <div className="relative shrink-0 border-b border-border px-3 py-2">
            <Search
              size={12}
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter runs…"
              aria-label="Filter runs"
              className="h-7 pl-7 text-[12px]"
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
              — no runs yet —
            </div>
          ) : shown.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
              — no matching runs —
            </div>
          ) : (
            <ul>
              {shown.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => pick(e)}
                    className="focus-accent flex w-full cursor-pointer flex-col gap-1 border-b border-border/60 px-4 py-2 text-left hover:bg-accent/60"
                  >
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
                      <span className="rounded-[3px] bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">
                        {e.tool}
                      </span>
                      <span
                        className={
                          e.status === "success" ? "text-success" : "text-destructive"
                        }
                      >
                        {e.status}
                      </span>
                      <span className="tnum text-text-dim">{Math.round(e.durationMs)}ms</span>
                      {e.rowCount != null && (
                        <span className="tnum text-text-dim">{e.rowCount} rows</span>
                      )}
                      <span className="tnum ml-auto text-muted-foreground">{relTime(e.at)}</span>
                    </div>
                    <code className="line-clamp-2 break-all font-mono text-[11px] text-foreground/80">
                      {e.text}
                    </code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
