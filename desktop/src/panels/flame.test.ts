import { describe, it, expect } from "vitest";
import {
  flameLayout,
  flameSpan,
  flameDepth,
  timeToX,
  xToTime,
  hitTest,
  minimapSkyline,
  formatAxisTime,
  timeAxisTicks,
} from "./flame";
import type { ExecNodeDto } from "../types";

function n(label: string, start: number, dur: number, children: ExecNodeDto[] = []): ExecNodeDto {
  return { label, detail: `${label}-d`, startNs: start, durNs: dur, selfNs: dur, children, source: null };
}

describe("flameLayout", () => {
  it("flattens tree with depth and absolute x", () => {
    const rects = flameLayout([n("METHOD_ENTRY", 0, 100, [n("SOQL_EXECUTE_BEGIN", 10, 30)])]);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ x: 0, w: 100, depth: 0, kind: "METHOD_ENTRY", label: "METHOD_ENTRY-d" });
    expect(rects[1]).toMatchObject({ x: 10, w: 30, depth: 1 });
  });
  it("span and depth", () => {
    const rects = flameLayout([n("A", 0, 100, [n("B", 10, 30)])]);
    expect(flameSpan(rects)).toEqual({ start: 0, end: 100 });
    expect(flameDepth(rects)).toBe(1);
  });
});

describe("geometry", () => {
  it("timeToX / xToTime round-trip", () => {
    expect(timeToX(50, 0, 100, 200)).toBe(100);
    expect(xToTime(100, 0, 100, 200)).toBe(50);
  });
  it("hitTest finds the rect at a point", () => {
    const rects = flameLayout([n("A", 0, 100, [n("B", 10, 30)])]);
    const hit = hitTest(rects, 40, 25, 0, 100, 100, 20); // x=40ns depth=1
    expect(hit?.kind).toBe("B");
  });
  it("minimapSkyline reports max depth per bucket", () => {
    const rects = flameLayout([n("A", 0, 100, [n("B", 0, 50)])]);
    const sky = minimapSkyline(rects, 0, 100, 2);
    expect(sky[0]).toBe(2); // depths 0 and 1 present in first half
  });
  it("formats axis labels relative to the trace origin", () => {
    expect(formatAxisTime(0)).toBe("+0 ns");
    expect(formatAxisTime(1_500)).toBe("+1.5 us");
    expect(formatAxisTime(1_500_000)).toBe("+1.50 ms");
    expect(formatAxisTime(-1_500_000_000)).toBe("-1.50 s");
  });
  it("builds evenly spaced time-axis ticks", () => {
    const ticks = timeAxisTicks(100, 500, 100, 3);
    expect(ticks).toEqual([
      { time: 100, pct: 0, label: "+0 ns" },
      { time: 300, pct: 0.5, label: "+200 ns" },
      { time: 500, pct: 1, label: "+400 ns" },
    ]);
  });
});
