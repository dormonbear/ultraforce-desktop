import { describe, it, expect } from "vitest";
import { groupStatements, totalNs, soqlFingerprint, groupByFingerprint } from "./queryStats";

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

describe("soqlFingerprint", () => {
  it("strips bind literals so loop-bound queries share a fingerprint", () => {
    const a = soqlFingerprint("SELECT Id FROM Account WHERE Id = '001aaa'");
    const b = soqlFingerprint("SELECT Id FROM Account WHERE Id = '001bbb'");
    expect(a).toBe(b);
  });
  it("collapses IN lists and numbers", () => {
    expect(soqlFingerprint("SELECT Id FROM A WHERE X IN ('a','b',3) LIMIT 50")).toBe(
      "SELECT ID FROM A WHERE X IN (?) LIMIT ?",
    );
  });
});

describe("groupByFingerprint", () => {
  it("groups by fingerprint and ranks by total time", () => {
    const fams = groupByFingerprint([
      { kind: "soql", text: "SELECT Id FROM Account WHERE Id = '1'", rows: 1, dur_ns: 100 },
      { kind: "soql", text: "SELECT Id FROM Account WHERE Id = '2'", rows: 1, dur_ns: 200 },
      { kind: "dml", text: "insert Account", rows: 1, dur_ns: 50 },
    ]);
    expect(fams).toHaveLength(2);
    expect(fams[0].count).toBe(2);
    expect(fams[0].totalNs).toBe(300);
    expect(fams[0].rows).toBe(2);
  });
});
