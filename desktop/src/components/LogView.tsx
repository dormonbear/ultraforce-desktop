import { useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Copy } from "lucide-react";
import { copyText } from "../clipboard";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { SourceRef } from "../panels/sourceRef";

const LINE_H = 18;

/** Color for an event name (the 2nd `|` field). */
function eventColor(ev: string): string {
  if (/FATAL_ERROR|EXCEPTION_THROWN/.test(ev)) return "text-destructive";
  if (ev === "USER_DEBUG") return "text-primary";
  if (/SOQL_EXECUTE|SOSL_EXECUTE|DML_|CALLOUT_/.test(ev)) return "text-success";
  if (/METHOD_|CONSTRUCTOR_|CODE_UNIT_|EXECUTION_/.test(ev))
    return "text-foreground";
  if (/LIMIT|HEAP_ALLOCATE|CUMULATIVE|STATEMENT_EXECUTE|VARIABLE_/.test(ev))
    return "text-muted-foreground";
  return "text-text-dim";
}

/** Per-token syntax highlight of one debug-log line:
 * `HH:MM:SS.d (nanos)|EVENT|field|field…`. Timestamp dim, event coloured by
 * category, `[..]` line/scope refs amber, 15/18-char SF Ids green, separators
 * faint. Non-event lines (header) render plain. */
function renderLine(line: string): ReactNode {
  const ts = line.match(/^\d{2}:\d{2}:\d{2}\.\d+ \(\d+\)/);
  if (!ts) return <span className="text-foreground">{line}</span>;
  const out: ReactNode[] = [];
  let k = 0;
  out.push(
    <span key={k++} className="text-text-dim opacity-70">
      {ts[0]}
    </span>,
  );
  line
    .slice(ts[0].length)
    .split("|")
    .forEach((f, i) => {
      if (i > 0)
        out.push(
          <span key={k++} className="text-text-dim opacity-40">
            |
          </span>,
        );
      if (f === "") return;
      let cls = "text-foreground";
      if (i === 1) cls = `font-medium ${eventColor(f)}`;
      else if (/^\[.*\]$/.test(f)) cls = "text-amber";
      else if (/^[a-zA-Z0-9]{15,18}$/.test(f)) cls = "text-success";
      out.push(
        <span key={k++} className={cls}>
          {f}
        </span>,
      );
    });
  return out;
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

/** Raw Salesforce debug log with per-event coloring + search/Debug-Only filter.
 * When `resolveSource` and `onSource` are given, lines present in `jumpableLines`
 * (raw-line indices the backend resolved to Apex source) are clickable and their
 * Apex source is resolved on demand, jumping to source when clicked. */
export function LogView({
  raw,
  resolveSource,
  onSource,
  jumpableLines,
}: {
  raw: string;
  resolveSource?: (rawLineIndex: number) => Promise<SourceRef | null>;
  onSource?: (ref: SourceRef) => void;
  jumpableLines?: Set<number>;
}) {
  const [q, setQ] = useState("");
  const [debugOnly, setDebugOnly] = useState(false);
  const [highlight, setHighlight] = useState(true);

  const lines = useMemo(() => raw.split("\n"), [raw]);
  // Filtered original-line indices, or null when nothing is filtered. The null
  // fast-path skips allocating a per-line array on open — the common case for a
  // freshly opened large log (no query, no Debug-Only).
  const filtered = useMemo<number[] | null>(() => {
    if (!q && !debugOnly) return null;
    const needle = q.toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (debugOnly && !l.includes("|USER_DEBUG|")) continue;
      if (needle && !l.toLowerCase().includes(needle)) continue;
      out.push(i);
    }
    return out;
  }, [lines, q, debugOnly]);
  const count = filtered ? filtered.length : lines.length;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_H,
    overscan: 24,
  });

  return (
    <div className="select-text flex h-full flex-col">
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
            aria-label="Toggle syntax highlighting"
          />
          Highlight
        </label>
        <button
          type="button"
          aria-label="Copy log"
          title="Copy the full log to the clipboard"
          onClick={() => void copyText(raw, "Log copied")}
          className="focus-accent flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-dim transition-colors hover:text-foreground"
        >
          <Copy size={13} />
        </button>
      </div>
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto bg-background px-3 py-2 font-mono text-[12px] leading-relaxed"
      >
        {count === 0 ? (
          <div className="text-[13px] text-muted-foreground">No matching lines</div>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const i = filtered ? filtered[vi.index] : vi.index;
              const l = lines[i];
              const clickable =
                resolveSource != null &&
                onSource != null &&
                (jumpableLines?.has(i) ?? false);
              return (
                <div
                  key={vi.key}
                  role={clickable ? "button" : undefined}
                  title={clickable ? "Jump to Apex source" : undefined}
                  onClick={
                    clickable
                      ? async () => {
                          const ref = await resolveSource(i);
                          if (ref) onSource(ref);
                        }
                      : undefined
                  }
                  className={`absolute left-0 top-0 w-full whitespace-pre ${
                    highlight ? "" : "text-text-dim"
                  } ${clickable ? "cursor-pointer hover:bg-primary/10" : ""}`}
                  style={{
                    height: LINE_H,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {highlight ? renderLine(l) : highlightAll(l, q)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
