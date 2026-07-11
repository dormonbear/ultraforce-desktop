import { describe, expect, it } from "vitest";
import { computeFillRatio } from "./fill";

describe("computeFillRatio", () => {
  it("stretches (ratio > 1) when columns undershoot the container", () => {
    // container 1000, gutter 52 → 948 usable over 474 of columns = 2×.
    expect(computeFillRatio(1000, 52, 474)).toBeCloseTo(2);
    expect(computeFillRatio(1000, 52, 948)).toBeCloseTo(1);
  });

  it("clamps to exactly 1 when columns overshoot the container", () => {
    expect(computeFillRatio(500, 52, 2000)).toBe(1);
  });

  it("returns 1 for zero or invalid inputs", () => {
    expect(computeFillRatio(0, 52, 474)).toBe(1);
    expect(computeFillRatio(-10, 52, 474)).toBe(1);
    expect(computeFillRatio(1000, 52, 0)).toBe(1);
    expect(computeFillRatio(1000, 52, -5)).toBe(1);
  });
});
