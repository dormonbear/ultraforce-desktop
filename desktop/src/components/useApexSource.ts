import { formatIpcError } from "../errorFormat";
import { useEffect, useState } from "react";
import type { editor } from "monaco-editor";
import { fetchApexSource } from "../ipc/apex";

export interface ApexSource {
  name: string;
  kind: string;
  body: string;
}

// Apex source cache for the log being viewed: a class's source is fetched from
// the org (~1s) only once while exploring one log. Scoped per-log — cleared on
// log switch via `clearApexSourceCache` so a different log starts fresh.
const sourceCache = new Map<string, ApexSource>();

/** Drop all cached Apex source. Call when switching to a different log. */
export function clearApexSourceCache(): void {
  sourceCache.clear();
}

/** Cache key is org-scoped so the same class name in two orgs can't collide. */
const cacheKey = (org: string | null, className: string) => `${org ?? ""}::${className}`;

/** Fetch an Apex class/trigger's source from `org`, re-fetching whenever
 * `className` (or `org`) changes. Served from the per-log cache on a repeat
 * lookup. Shared by SourceDialog (jump-to-source) and LogDebugger (which
 * re-fetches as the playhead crosses classes). */
export function useApexSource(
  className: string | null,
  org: string | null,
): {
  src: ApexSource | null;
  error: string | null;
} {
  const [src, setSrc] = useState<ApexSource | null>(
    () => (className && sourceCache.get(cacheKey(org, className))) || null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!className) {
      setSrc(null);
      return;
    }
    const key = cacheKey(org, className);
    const cached = sourceCache.get(key);
    if (cached) {
      setSrc(cached);
      return;
    }
    setSrc(null);
    let alive = true;
    fetchApexSource(className, org)
      .then((s) => {
        sourceCache.set(key, s);
        if (alive) setSrc(s);
      })
      .catch((e) => alive && setError(formatIpcError(e)));
    return () => {
      alive = false;
    };
  }, [className, org]);

  return { src, error };
}

/** Place the cursor on `line` and scroll it to the vertical center. Deferred to
 * the next frame: a freshly mounted editor reports a not-yet-laid-out viewport
 * height synchronously, which makes `revealLineInCenter` land the line at the
 * top (hidden under sticky-scroll headers) instead of the middle. No-op when the
 * editor isn't ready or there's no line. */
export function revealLine(
  ed: editor.IStandaloneCodeEditor | null,
  line: number | null,
): void {
  if (!ed || line == null) return;
  requestAnimationFrame(() => {
    ed.setPosition({ lineNumber: line, column: 1 });
    ed.revealLineInCenter(line);
  });
}
