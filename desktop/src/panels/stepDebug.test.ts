import { describe, expect, it } from "vitest";
import { nextFn, prevFn, stepInto, stepOut, stepOver, stepPrev } from "./stepDebug";
import type { DebugStep } from "./stepDebug";

// depth + whether the step opens a function.
//   0: outer code unit  depth 1, frame-start
//   1: into method A    depth 2, frame-start
//   2: statement in B   depth 3   (B entered)
//   3: back in A        depth 2
//   4: into method C    depth 1, frame-start
const fixture: [number, boolean][] = [
  [1, true],
  [2, true],
  [3, false],
  [2, false],
  [1, true],
];
const steps = fixture.map(
  ([depth, isFrameStart], i): DebugStep => ({
    unitIndex: 0,
    entryIndex: i,
    source: { className: "C", line: i },
    depth,
    isFrameStart,
  }),
);

describe("stepInto / stepPrev", () => {
  it("move by one and clamp at the ends", () => {
    expect(stepInto(steps, 0)).toBe(1);
    expect(stepPrev(steps, 2)).toBe(1);
    expect(stepInto(steps, 4)).toBe(4); // clamp at last
    expect(stepPrev(steps, 0)).toBe(0); // clamp at first
  });
});

describe("stepOver", () => {
  it("skips deeper frames, landing at the next step at or above current depth", () => {
    expect(stepOver(steps, 1)).toBe(3); // skip B (depth 3), land back in A
    expect(stepOver(steps, 0)).toBe(4); // skip everything deeper than outer
  });
  it("runs to the end when nothing at or above current depth follows", () => {
    expect(stepOver(steps, 4)).toBe(4);
  });
});

describe("stepOut", () => {
  it("runs until the current frame returns (next shallower depth)", () => {
    expect(stepOut(steps, 2)).toBe(3); // out of B → back in A
    expect(stepOut(steps, 1)).toBe(4); // out of A → back in outer
  });
  it("runs to the end when no shallower frame follows", () => {
    expect(stepOut(steps, 0)).toBe(4);
  });
});

describe("nextFn / prevFn", () => {
  it("jump to the next/previous function-opening step, skipping statements", () => {
    expect(nextFn(steps, 0)).toBe(1); // outer → method A
    expect(nextFn(steps, 1)).toBe(4); // method A → method C (skip B's statement)
    expect(prevFn(steps, 4)).toBe(1); // method C → method A
    expect(prevFn(steps, 3)).toBe(1); // from a statement back to method A
  });
  it("clamps at the ends when no function boundary follows/precedes", () => {
    expect(nextFn(steps, 4)).toBe(4); // last → stays (run-to-end)
    expect(prevFn(steps, 0)).toBe(0); // first → stays
  });
});
