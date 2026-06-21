import { describe, expect, it } from "vitest";
import { barState, phaseLabel, type Progress } from "./indexBar";

const p = (over: Partial<Progress>): Progress => ({
  org: "o",
  phase: "sobjects",
  done: 0,
  total: 0,
  ...over,
});

describe("barState", () => {
  it("is idle when no progress", () => {
    expect(barState(null)).toEqual({
      active: false,
      determinate: false,
      pct: 0,
    });
  });

  it("is determinate with a real percentage during sObjects", () => {
    expect(barState(p({ phase: "sobjects", done: 50, total: 200 }))).toEqual({
      active: true,
      determinate: true,
      pct: 25,
    });
  });

  it("clamps percentage to 100 and never divides by zero", () => {
    expect(barState(p({ phase: "sobjects", done: 5, total: 0 })).pct).toBe(0);
    expect(barState(p({ phase: "sobjects", done: 9, total: 4 })).pct).toBe(100);
  });

  it("is indeterminate for stdlib/classes (no meaningful total)", () => {
    expect(barState(p({ phase: "stdlib", done: 0, total: 1 })).determinate).toBe(
      false,
    );
    expect(
      barState(p({ phase: "classes", done: 0, total: 1 })).determinate,
    ).toBe(false);
  });
});

describe("phaseLabel", () => {
  it("counts objects, names other phases", () => {
    expect(phaseLabel(p({ phase: "sobjects", done: 3, total: 9 }))).toBe(
      "Indexing objects 3/9",
    );
    expect(phaseLabel(p({ phase: "classes" }))).toBe("Indexing Apex classes");
    expect(phaseLabel(p({ phase: "stdlib" }))).toBe("Indexing stdlib");
  });
});
