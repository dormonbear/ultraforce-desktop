import type { ExecNodeDto } from "../types";

export interface FlameRect {
  /** Absolute start offset in ns. */
  x: number;
  /** Duration in ns (>= 0; 0 for leaf/unclosed, rendered at 1px min). */
  w: number;
  depth: number;
  /** Display text. */
  label: string;
  /** Event-kind name, used for color. */
  kind: string;
  source: ExecNodeDto["source"];
}

/** Flatten the execution tree into positioned rects. */
export function flameLayout(roots: ExecNodeDto[]): FlameRect[] {
  const rects: FlameRect[] = [];
  const walk = (node: ExecNodeDto, depth: number) => {
    rects.push({
      x: node.startNs,
      w: node.durNs ?? 0,
      depth,
      label: node.detail || node.label,
      kind: node.label,
      source: node.source,
    });
    for (const c of node.children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return rects;
}

export function flameSpan(rects: FlameRect[]): { start: number; end: number } {
  if (rects.length === 0) return { start: 0, end: 0 };
  let start = Infinity;
  let end = 0;
  for (const r of rects) {
    if (r.x < start) start = r.x;
    if (r.x + r.w > end) end = r.x + r.w;
  }
  return { start, end };
}

export function flameDepth(rects: FlameRect[]): number {
  return rects.reduce((m, r) => Math.max(m, r.depth), 0);
}

export function timeToX(t: number, viewStart: number, viewEnd: number, width: number): number {
  if (viewEnd <= viewStart) return 0;
  return ((t - viewStart) / (viewEnd - viewStart)) * width;
}

export function xToTime(x: number, viewStart: number, viewEnd: number, width: number): number {
  if (width <= 0) return viewStart;
  return viewStart + (x / width) * (viewEnd - viewStart);
}

export function formatAxisTime(ns: number): string {
  const sign = ns < 0 ? "-" : "+";
  const abs = Math.abs(ns);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)} s`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)} ms`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)} us`;
  return `${sign}${Math.round(abs)} ns`;
}

export interface TimeTick {
  time: number;
  pct: number;
  label: string;
}

export function timeAxisTicks(
  viewStart: number,
  viewEnd: number,
  origin: number,
  targetCount = 5,
): TimeTick[] {
  if (viewEnd <= viewStart || targetCount < 2) return [];
  const count = Math.max(2, Math.floor(targetCount));
  const span = viewEnd - viewStart;
  return Array.from({ length: count }, (_, i) => {
    const pct = i / (count - 1);
    const time = viewStart + span * pct;
    return { time, pct, label: formatAxisTime(time - origin) };
  });
}

/** Topmost rect at canvas point (px, py) for the current viewport + row height. */
export function hitTest(
  rects: FlameRect[],
  px: number,
  py: number,
  viewStart: number,
  viewEnd: number,
  width: number,
  rowH: number,
): FlameRect | null {
  const depth = Math.floor(py / rowH);
  for (const r of rects) {
    if (r.depth !== depth) continue;
    const x0 = timeToX(r.x, viewStart, viewEnd, width);
    const x1 = timeToX(r.x + r.w, viewStart, viewEnd, width);
    if (px >= x0 && px <= Math.max(x1, x0 + 1)) return r;
  }
  return null;
}

/** Skyline density for the minimap: max depth reached in each of `n` buckets. */
export function minimapSkyline(rects: FlameRect[], start: number, end: number, n: number): number[] {
  const buckets = Array.from({ length: n }, () => 0);
  if (end <= start) return buckets;
  for (const r of rects) {
    const b = Math.min(n - 1, Math.floor(((r.x - start) / (end - start)) * n));
    if (r.depth + 1 > buckets[b]) buckets[b] = r.depth + 1;
  }
  return buckets;
}
