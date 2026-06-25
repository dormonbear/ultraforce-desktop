import { describe, it, expect } from "vitest";
import { groupStatements, totalNs } from "./queryStats";

describe("queryStats", () => {
  const stmts = [
    { kind: "soql", text: "SELECT Id FROM Account", rows: 5, dur_ns: 1_000_000 },
    { kind: "soql", text: "SELECT Id FROM Account", rows: 3, dur_ns: 2_000_000 },
    { kind: "soql", text: "SELECT Id FROM Contact", rows: 50, dur_ns: 9_000_000 },
    { kind: "dml", text: "Insert Account", rows: 1, dur_ns: null },
  ];

  it("groups identical statements with count, rows, total time", () => {
    const g = groupStatements(stmts);
    const acct = g.find((x) => x.text === "SELECT Id FROM Account")!;
    expect(acct.count).toBe(2);
    expect(acct.rows).toBe(8);
    expect(acct.totalNs).toBe(3_000_000);
  });

  it("ranks by total time desc (hotspot first), not just count", () => {
    const g = groupStatements(stmts);
    // Contact (9ms, 1×) outranks Account (3ms, 2×).
    expect(g[0].text).toBe("SELECT Id FROM Contact");
    expect(g[1].text).toBe("SELECT Id FROM Account");
  });

  it("treats null durations as zero", () => {
    expect(totalNs(stmts)).toBe(12_000_000);
    expect(groupStatements(stmts).find((x) => x.kind === "dml")!.totalNs).toBe(0);
  });
});
