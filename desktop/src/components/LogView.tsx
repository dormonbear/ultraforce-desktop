import { useMemo, useState } from "react";
import { Search } from "lucide-react";

/** Color class for a log line based on its event token (2nd `|` field). */
function lineClass(line: string): string {
  if (/\|(FATAL_ERROR|EXCEPTION_THROWN)\|/.test(line)) return "text-destructive";
  if (/\|USER_DEBUG\|/.test(line)) return "text-primary";
  if (/\|(LIMIT_USAGE|HEAP_ALLOCATE|CUMULATIVE_LIMIT)/.test(line)) return "text-muted-foreground";
  return "text-text-dim";
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

  const render = (line: string) => {
    if (!highlight || !q) return line;
    const idx = line.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return line;
    return (
      <>
        {line.slice(0, idx)}
        <mark className="bg-primary/30 text-foreground">{line.slice(idx, idx + q.length)}</mark>
        {line.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 text-[11px]">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter log…"
            aria-label="Filter log"
            className="focus-accent w-full rounded-md border border-border bg-card py-1 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-1 text-text-dim">
          <input type="checkbox" checked={debugOnly} onChange={(e) => setDebugOnly(e.target.checked)} />
          Debug Only
        </label>
        <label className="flex cursor-pointer items-center gap-1 text-text-dim">
          <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
          Highlight
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background px-3 py-2 font-mono text-[12px] leading-relaxed">
        {filtered.length === 0 ? (
          <div className="text-muted-foreground">— no matching lines —</div>
        ) : (
          filtered.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap ${lineClass(l)}`}>
              {render(l)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
