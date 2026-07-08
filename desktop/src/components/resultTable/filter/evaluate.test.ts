import { describe, expect, it } from "vitest";
import type { RuleGroupType } from "react-querybuilder";
import { evaluateGroup, type RowCtx } from "./evaluate";
import type { ChildTableDto } from "../../../types";

const contacts = (rows: ChildTableDto["rows"]): ChildTableDto => ({
  rowIndex: 0,
  column: "Contacts",
  totalSize: rows.length,
  done: true,
  columns: ["LastName", "Age__c"],
  rows,
});

const ctx = (children?: ChildTableDto): RowCtx => ({
  parent: { Id: "001A", Name: "Acme", Amount: "150" },
  children: new Map(children ? [[children.column, children]] : []),
});

const g = (rules: RuleGroupType["rules"], combinator = "and"): RuleGroupType => ({
  combinator,
  rules,
});

describe("parent field rules", () => {
  it("compares numbers numerically, not lexicographically", () => {
    // "150" > "9" numerically true; lexicographic would say false.
    expect(evaluateGroup(g([{ field: "Amount", operator: ">", value: "9" }]), ctx())).toBe(true);
    expect(evaluateGroup(g([{ field: "Amount", operator: "<", value: "9" }]), ctx())).toBe(false);
  });

  it("supports contains / beginsWith / null / between and or/not", () => {
    expect(evaluateGroup(g([{ field: "Name", operator: "contains", value: "cm" }]), ctx())).toBe(true);
    expect(evaluateGroup(g([{ field: "Name", operator: "beginsWith", value: "Ac" }]), ctx())).toBe(true);
    expect(evaluateGroup(g([{ field: "Id", operator: "null", value: "" }]), ctx())).toBe(false);
    expect(
      evaluateGroup(g([{ field: "Amount", operator: "between", value: "100,200" }]), ctx())
    ).toBe(true);
    expect(
      evaluateGroup(
        {
          combinator: "or",
          not: true,
          rules: [
            { field: "Name", operator: "=", value: "Nope" },
            { field: "Id", operator: "=", value: "Nope" },
          ],
        },
        ctx()
      )
    ).toBe(true);
  });
});

describe("match-mode rules over child tables", () => {
  const rows: ChildTableDto["rows"] = [
    ["Yin", 9],
    ["Zhao", 10],
    ["Wu", 30],
  ];
  const sub: RuleGroupType = {
    combinator: "and",
    rules: [{ field: "Age__c", operator: ">=", value: "10" }],
  };
  const rule = (mode: string, threshold?: number) =>
    g([{ field: "Contacts", operator: "=", match: { mode, threshold }, value: sub } as never]);

  it("evaluates some/all/none against typed child values", () => {
    expect(evaluateGroup(rule("some"), ctx(contacts(rows)))).toBe(true);
    expect(evaluateGroup(rule("all"), ctx(contacts(rows)))).toBe(false);
    expect(evaluateGroup(rule("none"), ctx(contacts(rows)))).toBe(false);
    // 9 vs "10": typed numeric comparison — 9 >= 10 is false (lexicographic "9">="10" is true!)
    expect(
      evaluateGroup(rule("all"), ctx(contacts([["Zhao", 10], ["Wu", 30]])))
    ).toBe(true);
  });

  it("evaluates count thresholds", () => {
    expect(evaluateGroup(rule("atLeast", 2), ctx(contacts(rows)))).toBe(true);
    expect(evaluateGroup(rule("atMost", 1), ctx(contacts(rows)))).toBe(false);
    expect(evaluateGroup(rule("exactly", 2), ctx(contacts(rows)))).toBe(true);
  });

  it("treats a missing relationship entry as zero child rows", () => {
    expect(evaluateGroup(rule("some"), ctx())).toBe(false);
    expect(evaluateGroup(rule("none"), ctx())).toBe(true);
    expect(evaluateGroup(rule("all"), ctx())).toBe(true); // vacuous
  });
});

describe("edge behavior", () => {
  it("empty group filters nothing; unknown operator passes", () => {
    expect(evaluateGroup(g([]), ctx())).toBe(true);
    expect(evaluateGroup(g([{ field: "Name", operator: "??", value: "x" }]), ctx())).toBe(true);
  });
});
