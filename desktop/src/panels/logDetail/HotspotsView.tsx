import { parseSourceRef, type SourceRef } from "../sourceRef";
import { formatMs, formatBytes } from "./format";
import type { HotspotDto, UnitDto } from "../../types";

/** Aggregate hotspots: top method/unit frames by self time across the log. */
export function HotspotsView({
  units,
  onSource,
}: {
  units: UnitDto[];
  onSource?: (ref: SourceRef) => void;
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
      m.selfNs += h.selfNs;
      m.totalNs += h.totalNs;
      m.selfBytes += h.selfBytes;
      m.count += h.count;
    } else {
      merged.set(h.signature, { ...h });
    }
  }
  const rows = [...merged.values()].sort((a, b) => b.selfNs - a.selfNs);
  const maxSelf = rows[0].selfNs; // rows are sorted desc by selfNs; non-empty (see `all` check above)
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="fjord-th border-b border-border">
          <th className="py-1 text-left">Method</th>
          <th className="whitespace-nowrap px-1.5 py-1 text-right">Self</th>
          <th className="whitespace-nowrap px-1.5 py-1 text-right">Total</th>
          <th className="whitespace-nowrap px-1.5 py-1 text-right">Heap</th>
          <th className="whitespace-nowrap px-1.5 py-1 text-right">Calls</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(
          // fallow-ignore-next-line complexity
          (h, i) => {
          const ref = parseSourceRef(h.signature);
          return (
          <tr key={i} className="border-t border-line-2 text-text-dim">
            <td
              className="relative w-full max-w-0 truncate py-0.5 pr-2 text-foreground"
            >
              <span
                className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-primary/10"
                style={{ width: `${maxSelf > 0 ? (h.selfNs / maxSelf) * 100 : 0}%` }}
                aria-hidden
              />
              {ref && onSource ? (
                <button
                  type="button"
                  onClick={() => onSource(ref)}
                  className="cursor-pointer truncate text-left hover:text-primary hover:underline"
                >
                  {h.signature}
                </button>
              ) : (
                h.signature
              )}
            </td>
            <td className="tnum whitespace-nowrap px-1.5 py-0.5 text-right font-mono text-foreground">
              {formatMs(h.selfNs)}
            </td>
            <td className="tnum whitespace-nowrap px-1.5 py-0.5 text-right font-mono">{formatMs(h.totalNs)}</td>
            <td className="tnum whitespace-nowrap px-1.5 py-0.5 text-right font-mono">
              {h.selfBytes > 0 ? formatBytes(h.selfBytes) : "—"}
            </td>
            <td className="tnum whitespace-nowrap px-1.5 py-0.5 text-right font-mono">{h.count}</td>
          </tr>
          );
          },
        )}
      </tbody>
    </table>
  );
}
