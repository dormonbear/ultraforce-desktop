import { describe, expect, it } from "vitest";
import {
  AUTO_FIT_SAMPLE,
  autoFitWidths,
  MAX_COL_PX,
  MIN_COL_PX,
  sizingKey,
  type TextMeasurer,
} from "./autoFit";

/** Deterministic measurer: header 10px/char, cell 7px/char. */
const m: TextMeasurer = {
  header: (t) => t.length * 10,
  cell: (t) => t.length * 7,
};

const rows = (col: string, values: string[]) => values.map((v) => ({ [col]: v }));

describe("autoFitWidths", () => {
  it("header text dominates short cells (header width + extras)", () => {
    const w = autoFitWidths(["AccountNumber"], rows("AccountNumber", ["1", "22"]), m);
    // 13 chars * 10 + 48 header extras = 178
    expect(w["AccountNumber"]).toBe(178);
  });

  it("longest sampled cell dominates a short header", () => {
    const w = autoFitWidths(["Id"], rows("Id", ["x", "0015g00000AbCdEfGH"]), m);
    // 18 chars * 7 + 24 cell padding = 150 > header 2*10+48
    expect(w["Id"]).toBe(150);
  });

  it("clamps to MIN_COL_PX and MAX_COL_PX", () => {
    const w = autoFitWidths(
      ["A", "B"],
      [{ A: "", B: "y".repeat(200) }],
      m,
    );
    expect(w["A"]).toBe(MIN_COL_PX);
    expect(w["B"]).toBe(MAX_COL_PX);
  });

  it("ignores rows beyond the sample window and missing keys", () => {
    const wide = { Name: "z".repeat(100) };
    const sampled = Array.from({ length: AUTO_FIT_SAMPLE }, () => ({}) as Record<string, string>);
    const w = autoFitWidths(["Name"], [...sampled, wide], m);
    // Row 51 (the wide one) is outside the sample; missing keys measure as "".
    expect(w["Name"]).toBe(4 * 10 + 48);
  });
});

describe("sizingKey", () => {
  it("distinguishes column sets and orders", () => {
    expect(sizingKey(["A", "B"])).not.toBe(sizingKey(["B", "A"]));
    expect(sizingKey(["A", "B"])).toBe(sizingKey(["A", "B"]));
    expect(sizingKey(["A", "B"])).not.toBe(sizingKey(["A", "B", "C"]));
  });
});
