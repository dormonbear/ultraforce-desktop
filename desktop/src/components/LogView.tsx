import { useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

const LINE_H = 18;

/** Color class for a log line based on its event token (2nd `|` field). */
function lineClass(line: string): string {
  if (/\|(FATAL_ERROR|EXCEPTION_THROWN)\|/.test(line)) return "text-destructive";
  if (/\|USER_DEBUG\|/.test(line)) return "text-primary";
  if (/\|(LIMIT_USAGE|HEAP_ALLOCATE|CUMULATIVE_LIMIT)/.test(line))
    return "text-muted-foreground";
  return "text-text-dim";
}

/** Wrap every (case-insensitive) occurrence of `q` in the line with a <mark>. */
function highlightAll(line: string, q: string): ReactNode {
  if (!q) return line;
  const lower = line.toLowerCase();
  const needle = q.toLowerCase();
  const out: ReactNode[] = [];
  let from = 0;
  let idx = lower.indexOf(needle, from);
  let k = 0;
  while (idx >= 0) {
    if (idx > from) out.push(line.slice(from, idx));
    out.push(
      <mark key={k++} className="bg-primary/30 text-foreground">
        {line.slice(idx, idx + q.length)}
      </mark>
    );
    from = idx + q.length;
    idx = lower.indexOf(needle, from);
  }
  if (from < line.length) out.push(line.slice(from));
  return out;
}

/** Raw Salesforce debug log with per-event coloring + search/Debug-Only filter. */
export function LogView({ raw }: { raw: string }) {
  const [q, setQ] = useState("");
  const [debugOnly, setDebugOnly] = useState(false);
  const [highlight, setHighlight] = useState(true);

  const lines = useMemo(() => raw.split("\n"), [raw]);
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return lines.filter((l) => {
      if (debugOnly && !l.includes("|USER_DEBUG|")) return false;
      if (needle && !l.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [lines, q, debugOnly]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_H,
    overscan: 24,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 text-[11px]">
        <div className="relative flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter log…"
            aria-label="Filter log"
            className="h-7 pl-7 text-[12px]"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-text-dim">
          <Checkbox
            checked={debugOnly}
            onCheckedChange={(v) => setDebugOnly(v === true)}
            aria-label="Show debug lines only"
          />
          Debug Only
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-text-dim">
          <Checkbox
            checked={highlight}
            onCheckedChange={(v) => setHighlight(v === true)}
            aria-label="Highlight matches"
          />
          Highlight
        </label>
      </div>
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto bg-background px-3 py-2 font-mono text-[12px] leading-relaxed"
      >
        {filtered.length === 0 ? (
          <div className="text-muted-foreground">— no matching lines —</div>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const l = filtered[vi.index];
              return (
                <div
                  key={vi.key}
                  className={`absolute left-0 top-0 w-full whitespace-pre ${lineClass(l)}`}
                  style={{
                    height: LINE_H,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {highlight ? highlightAll(l, q) : l}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
