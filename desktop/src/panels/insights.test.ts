import { describe, it, expect } from "vitest";
import { soqlFingerprint } from "./soqlFingerprint";
import { detectInsights } from "./insights";
import type { ExecNodeDto, StatementDto, UnitDto } from "../types";

const node = (label: string, children: ExecNodeDto[] = []): ExecNodeDto => ({
  label,
  detail: "",
  durNs: 1000,
  selfNs: 100,
  startNs: 0,
  children,
  source: null,
});

const unit = (over: Partial<UnitDto> = {}): UnitDto => ({
  tree: [],
  hotspots: [],
  statements: [],
  limits: [],
  exceptions: [],
  ...over,
});

describe("soqlFingerprint", () => {
  it("groups statements that differ only by literals", () => {
    const a = soqlFingerprint("SELECT Id FROM Account WHERE Id = '001aaa'");
    const b = soqlFingerprint("SELECT Id FROM Account WHERE Id = '001zzz'");
    expect(a).toBe(b);
    expect(a).toBe("SELECT Id FROM Account WHERE Id = ?");
  });

  it("collapses IN lists, bind vars, and numbers", () => {
    expect(soqlFingerprint("SELECT Id FROM A WHERE X IN ('a','b','c')")).toBe(
      "SELECT Id FROM A WHERE X IN (?)",
    );
    expect(soqlFingerprint("SELECT Id FROM A WHERE Id = :acctId LIMIT 200")).toBe(
      "SELECT Id FROM A WHERE Id = :? LIMIT ?",
    );
  });
});

describe("detectInsights", () => {
  it("flags a query run in a loop (grouped by fingerprint, varying literal)", () => {
    const statements: StatementDto[] = Array.from({ length: 6 }, (_, i) => ({
      kind: "soql" as const,
      text: `SELECT Id FROM Contact WHERE AccountId = '001x${i}'`,
      rows: 2,
      durNs: 1_000_000,
    }));
    const f = detectInsights([unit({ statements })]);
    const loop = f.find((x) => x.kind === "stmt-in-loop");
    expect(loop).toBeTruthy();
    expect(loop!.severity).toBe("crit");
    expect(loop!.title).toContain("6×");
  });

  it("does not flag a query that runs only a few times", () => {
    const statements: StatementDto[] = [
      { kind: "soql", text: "SELECT Id FROM Account", rows: 1, durNs: 1 },
      { kind: "soql", text: "SELECT Id FROM Account", rows: 1, durNs: 1 },
    ];
    expect(detectInsights([unit({ statements })]).some((x) => x.kind === "stmt-in-loop")).toBe(
      false,
    );
  });

  it("detects a loop body (a node repeated consecutively under one parent)", () => {
    const children = Array.from({ length: 6 }, () => node("doWork"));
    const tree = [node("LoopMethod", children)];
    const lb = detectInsights([unit({ tree })]).find((x) => x.kind === "loop-body");
    expect(lb).toBeTruthy();
    expect(lb!.title).toContain("doWork runs 6×");
  });

  it("detects recursion (a unit that re-enters itself)", () => {
    // A -> B -> A
    const tree = [node("A", [node("B", [node("A")])])];
    const f = detectInsights([unit({ tree })]);
    const rec = f.find((x) => x.kind === "recursion");
    expect(rec).toBeTruthy();
    expect(rec!.title).toContain("A re-enters itself");
  });

  it("does not report recursion for distinct nested calls", () => {
    const tree = [node("A", [node("B", [node("C")])])];
    expect(detectInsights([unit({ tree })]).some((x) => x.kind === "recursion")).toBe(false);
  });

  it("flags a governor limit near breach, ranked crit-first", () => {
    const limits = [
      { namespace: "", entries: [{ name: "SOQL queries", used: 98, max: 100 }] },
    ];
    const f = detectInsights([unit({ limits })]);
    expect(f[0].severity).toBe("crit");
    expect(f[0].kind).toBe("limit");
    expect(f[0].title).toContain("98%");
  });

  it("flags a large query (high row count), not as a loop", () => {
    const statements: StatementDto[] = [
      { kind: "soql", text: "SELECT Id FROM Account", rows: 5000, durNs: 1000 },
    ];
    const f = detectInsights([unit({ statements })]);
    const big = f.find((x) => x.kind === "slow-query");
    expect(big).toBeTruthy();
    expect(big!.title).toContain("5000 rows");
  });

  it("flags a slow query by duration", () => {
    const statements: StatementDto[] = [
      { kind: "soql", text: "SELECT Id FROM Account", rows: 1, durNs: 250_000_000 },
    ];
    const f = detectInsights([unit({ statements })]);
    expect(f.find((x) => x.kind === "slow-query")?.title).toMatch(/Slow query/);
  });

  it("surfaces a fatal error as a crit finding, ranked first", () => {
    const f = detectInsights([
      unit({
        exceptions: [
          { kind: "FATAL_ERROR", message: "System.LimitException: Too many SOQL queries: 101" },
        ],
      }),
    ]);
    expect(f[0].kind).toBe("exception");
    expect(f[0].severity).toBe("crit");
    expect(f[0].title).toContain("Too many SOQL");
  });

  it("groups a repeated exception with a count", () => {
    const exceptions = Array.from({ length: 3 }, () => ({
      kind: "EXCEPTION_THROWN",
      message: "System.NullPointerException: x",
    }));
    const f = detectInsights([unit({ exceptions })]);
    const ex = f.find((x) => x.kind === "exception");
    expect(ex!.severity).toBe("warn");
    expect(ex!.title).toContain("×3");
  });

  it("reports the dominant critical path through the tree", () => {
    const dnode = (
      label: string,
      durNs: number,
      selfNs: number,
      children: ExecNodeDto[] = [],
    ): ExecNodeDto => ({ label, detail: "", durNs: durNs, selfNs: selfNs, startNs: 0, children, source: null });
    // root 1000 → A 900 → B 850 (self 800); a tiny sibling that's off the path.
    const tree = [
      dnode("root", 1000, 50, [
        dnode("A", 900, 50, [dnode("B", 850, 800)]),
        dnode("tiny", 10, 10),
      ]),
    ];
    const cp = detectInsights([unit({ tree })]).find((x) => x.kind === "critical-path");
    expect(cp).toBeTruthy();
    expect(cp!.severity).toBe("info");
    expect(cp!.detail).toBe("root → A → B");
    expect(cp!.title).toContain("ends in B");
  });
});
