import { describe, it, expect } from "vitest";
import { totalNs, soqlFingerprint, groupByFingerprint } from "./queryStats";

describe("queryStats", () => {
  const stmts = [
    { kind: "soql", text: "SELECT Id FROM Account", rows: 5, durNs: 1_000_000 },
    { kind: "soql", text: "SELECT Id FROM Account", rows: 3, durNs: 2_000_000 },
    { kind: "soql", text: "SELECT Id FROM Contact", rows: 50, durNs: 9_000_000 },
    { kind: "dml", text: "Insert Account", rows: 1, durNs: null },
  ];

  it("treats null durations as zero", () => {
    expect(totalNs(stmts)).toBe(12_000_000);
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
      { kind: "soql", text: "SELECT Id FROM Account WHERE Id = '1'", rows: 1, durNs: 100 },
      { kind: "soql", text: "SELECT Id FROM Account WHERE Id = '2'", rows: 1, durNs: 200 },
      { kind: "dml", text: "insert Account", rows: 1, durNs: 50 },
    ]);
    expect(fams).toHaveLength(2);
    expect(fams[0].count).toBe(2);
    expect(fams[0].totalNs).toBe(300);
    expect(fams[0].rows).toBe(2);
  });
});
