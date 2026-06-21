import { describe, it, expect } from "vitest";
import { filterTree, findMatches, makeMatcher } from "./search";
import type { TreeNode } from "./tree";

const tree: TreeNode[] = [
  {
    path: "/r/Customers",
    name: "Customers",
    kind: "dir",
    children: [
      { path: "/r/Customers/top-accounts.soql", name: "top-accounts.soql", kind: "file" },
      { path: "/r/Customers/leads.soql", name: "leads.soql", kind: "file" },
    ],
  },
  { path: "/r/scratch.soql", name: "scratch.soql", kind: "file" },
];

describe("filterTree", () => {
  it("keeps matching files and their ancestor dirs", () => {
    const out = filterTree(tree, "account");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Customers");
    expect(out[0].children?.map((c) => c.name)).toEqual(["top-accounts.soql"]);
  });
  it("returns the original tree for an empty query", () => {
    expect(filterTree(tree, "  ")).toBe(tree);
  });
  it("matches dir names too, dropping non-matching children", () => {
    const out = filterTree(tree, "custom");
    expect(out.map((n) => n.name)).toEqual(["Customers"]);
  });
});

describe("findMatches", () => {
  it("returns 1-based trimmed lines containing the query (case-insensitive)", () => {
    const out = findMatches("SELECT Id\nFROM Account\n  WHERE Name = 'x'", "name");
    expect(out).toEqual([{ line: 3, text: "WHERE Name = 'x'" }]);
  });
  it("returns nothing for an empty query", () => {
    expect(findMatches("anything", "")).toEqual([]);
  });
});

describe("makeMatcher", () => {
  it("is case-insensitive by default", () => {
    expect(makeMatcher("name")("FROM Name")).toBe(true);
  });
  it("respects caseSensitive", () => {
    expect(makeMatcher("Name", { caseSensitive: true })("name")).toBe(false);
    expect(makeMatcher("Name", { caseSensitive: true })("Name")).toBe(true);
  });
  it("supports regex", () => {
    expect(makeMatcher("Acc.*t", { regex: true })("Account")).toBe(true);
  });
  it("invalid regex never matches", () => {
    expect(makeMatcher("(", { regex: true })("anything")).toBe(false);
  });
});

describe("findMatches with options", () => {
  it("regex matches whole-word via anchors", () => {
    const out = findMatches("Id\nName\nAccountName", "\\bName\\b", { regex: true });
    expect(out.map((m) => m.line)).toEqual([2]);
  });
});
