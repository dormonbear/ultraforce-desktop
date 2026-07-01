import { describe, it, expect } from "vitest";
import { flameLayout, flameSpan, flameDepth, timeToX, xToTime, hitTest, minimapSkyline } from "./flame";
import type { ExecNodeDto } from "../types";

function n(label: string, start: number, dur: number, children: ExecNodeDto[] = []): ExecNodeDto {
  return { label, detail: `${label}-d`, start_ns: start, dur_ns: dur, self_ns: dur, children, source: null };
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
});
