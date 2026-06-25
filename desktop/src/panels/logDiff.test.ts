import { describe, it, expect } from "vitest";
import { diffLogs } from "./logDiff";
import type { StatementDto, UnitDto } from "../types";

const unit = (over: Partial<UnitDto> = {}): UnitDto => ({
  tree: [],
  hotspots: [],
  statements: [],
  limits: [],
  exceptions: [],
  ...over,
});

const soql = (text: string): StatementDto => ({ kind: "soql", text, rows: 1, dur_ns: 1000 });

describe("diffLogs", () => {
  it("flags a query that went from few to many runs (regression), grouped by fingerprint", () => {
    const a = [unit({ statements: [soql("SELECT Id FROM Account WHERE Id = '001a'")] })];
    const b = [
      unit({
        statements: Array.from({ length: 20 }, (_, i) =>
          soql(`SELECT Id FROM Account WHERE Id = '001x${i}'`),
        ),
      }),
    ];
    const d = diffLogs(a, b);
    expect(d.queries).toHaveLength(1);
    expect(d.queries[0].countA).toBe(1);
    expect(d.queries[0].countB).toBe(20);
    expect(d.queries[0].fp).toBe("SELECT Id FROM Account WHERE Id = ?");
    expect(d.totals.soqlA).toBe(1);
    expect(d.totals.soqlB).toBe(20);
  });

  it("includes a query new in B (absent in A)", () => {
    const d = diffLogs([], [unit({ statements: [soql("SELECT Id FROM Contact")] })]);
    expect(d.queries[0].countA).toBe(0);
    expect(d.queries[0].countB).toBe(1);
  });

  it("ignores unchanged queries", () => {
    const same = () => [unit({ statements: [soql("SELECT Id FROM Account WHERE Id = '001a'")] })];
    expect(diffLogs(same(), same()).queries).toHaveLength(0);
  });

  it("diffs limit usage", () => {
    const mk = (used: number) =>
      unit({ limits: [{ namespace: "", entries: [{ name: "SOQL queries", used, max: 100 }] }] });
    const d = diffLogs([mk(10)], [mk(95)]);
    expect(d.limits[0]).toMatchObject({ name: "SOQL queries", usedA: 10, usedB: 95, max: 100 });
  });
});
