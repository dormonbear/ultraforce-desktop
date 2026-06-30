import { describe, expect, it } from "vitest";
import { filterTree } from "./logTree";
import type { ExecNodeDto } from "../types";

const node = (
  label: string,
  detail = "",
  children: ExecNodeDto[] = [],
): ExecNodeDto => ({ label, detail, dur_ns: null, self_ns: null, children, source: null });

const tree: ExecNodeDto[] = [
  node("CODE_UNIT_STARTED", "Trigger.AccountTrigger", [
    node("METHOD_ENTRY", "AccountService.handle", [
      node("SOQL_EXECUTE_BEGIN", "SELECT Id FROM Contact"),
    ]),
    node("DML_BEGIN", "insert Account"),
  ]),
];

describe("filterTree", () => {
  it("returns the tree unchanged for an empty query", () => {
    expect(filterTree(tree, "")).toBe(tree);
    expect(filterTree(tree, "   ")).toBe(tree);
  });

  it("keeps only paths to matching nodes", () => {
    const out = filterTree(tree, "SOQL");
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("CODE_UNIT_STARTED");
    expect(out[0].children).toHaveLength(1); // METHOD_ENTRY kept, DML_BEGIN pruned
    expect(out[0].children[0].label).toBe("METHOD_ENTRY");
    expect(out[0].children[0].children[0].label).toBe("SOQL_EXECUTE_BEGIN");
  });

  it("matches on detail text too", () => {
    const out = filterTree(tree, "account");
    // CODE_UNIT detail + DML detail both contain "Account".
    expect(out[0].label).toBe("CODE_UNIT_STARTED");
  });

  it("a matching node keeps its full subtree", () => {
    const out = filterTree(tree, "METHOD_ENTRY");
    expect(out[0].children[0].children).toHaveLength(1); // SOQL child retained
  });

  it("returns empty when nothing matches", () => {
    expect(filterTree(tree, "zzz-nope")).toHaveLength(0);
  });
});
