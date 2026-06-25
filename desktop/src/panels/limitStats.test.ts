import { describe, it, expect } from "vitest";
import { usagePct, limitSeverity, rankByUsage } from "./limitStats";

describe("limitStats", () => {
  it("computes usage percent, capped at 100, 0 when no cap", () => {
    expect(usagePct(50, 100)).toBe(50);
    expect(usagePct(3, 4)).toBe(75);
    expect(usagePct(200, 100)).toBe(100);
    expect(usagePct(5, 0)).toBe(0);
  });

  it("classifies severity by ratio", () => {
    expect(limitSeverity(10, 100)).toBe("ok");
    expect(limitSeverity(60, 100)).toBe("warn");
    expect(limitSeverity(95, 100)).toBe("crit");
    expect(limitSeverity(100, 100)).toBe("crit");
    expect(limitSeverity(5, 0)).toBe("ok");
  });

  it("ranks tightest-first", () => {
    const ranked = rankByUsage([
      { name: "SOQL", used: 10, max: 100 }, // 10%
      { name: "CPU", used: 95, max: 100 }, // 95%
      { name: "DML", used: 60, max: 100 }, // 60%
    ]);
    expect(ranked.map((e) => e.name)).toEqual(["CPU", "DML", "SOQL"]);
  });
});
