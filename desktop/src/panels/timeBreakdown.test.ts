import { describe, it, expect } from "vitest";
import { timeBreakdown } from "./timeBreakdown";
import type { UnitDto, ExecNodeDto } from "../types";

function node(label: string, selfNs: number, children: ExecNodeDto[] = []): ExecNodeDto {
  return { label, detail: "", startNs: 0, durNs: selfNs, selfNs, children, source: null };
}
function unit(tree: ExecNodeDto[]): UnitDto {
  return { tree, hotspots: [], statements: [], limits: [] } as unknown as UnitDto;
}

describe("timeBreakdown", () => {
  it("buckets self-time by event category and computes pct", () => {
    const u = unit([
      node("METHOD_ENTRY", 60, [node("SOQL_EXECUTE_BEGIN", 30), node("DML_BEGIN", 10)]),
    ]);
    const slices = timeBreakdown([u]);
    const byCat = Object.fromEntries(slices.map((s) => [s.category, s.ns]));
    expect(byCat.apex).toBe(60);
    expect(byCat.soql).toBe(30);
    expect(byCat.dml).toBe(10);
    const apex = slices.find((s) => s.category === "apex")!;
    expect(Math.round(apex.pct)).toBe(60);
  });

  it("returns empty for no time", () => {
    expect(timeBreakdown([unit([])])).toEqual([]);
  });
});
