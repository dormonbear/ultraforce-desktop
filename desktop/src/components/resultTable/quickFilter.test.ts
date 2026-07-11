import { describe, expect, it } from "vitest";
import type { RuleGroupType } from "react-querybuilder";
import { getQuickMode, setQuickFilter } from "./quickFilter";

const empty: RuleGroupType = { combinator: "and", rules: [] };
const userRule = { field: "Name", operator: "contains", value: "x" };

describe("quick child-presence filter rules", () => {
  it("adds a tagged match rule the evaluator reads as 'has any child'", () => {
    const f = setQuickFilter(empty, "Contacts", "some");
    expect(f.rules).toHaveLength(1);
    const r = f.rules[0] as unknown as Record<string, unknown>;
    expect(r.id).toBe("quick:Contacts");
    expect(r.field).toBe("Contacts");
    expect(r.match).toEqual({ mode: "some" });
    // Empty subgroup: matches every loaded child row (evaluator semantics).
    expect(r.value).toEqual({ combinator: "and", rules: [] });
    expect(getQuickMode(f, "Contacts")).toBe("some");
    expect(getQuickMode(f, "Opportunities")).toBeNull();
  });

  it("replaces the rule when switching modes (mutually exclusive)", () => {
    const f1 = setQuickFilter(empty, "Contacts", "some");
    const f2 = setQuickFilter(f1, "Contacts", "none");
    expect(f2.rules).toHaveLength(1);
    expect(getQuickMode(f2, "Contacts")).toBe("none");
  });

  it("removes the rule when mode is null", () => {
    const f1 = setQuickFilter(empty, "Contacts", "none");
    const f2 = setQuickFilter(f1, "Contacts", null);
    expect(f2.rules).toHaveLength(0);
    expect(getQuickMode(f2, "Contacts")).toBeNull();
  });

  it("leaves user-authored rules and other columns' quick rules untouched", () => {
    const base: RuleGroupType = { combinator: "and", rules: [userRule] };
    const f1 = setQuickFilter(base, "Contacts", "some");
    const f2 = setQuickFilter(f1, "Opportunities", "none");
    expect(f2.rules).toHaveLength(3);
    const f3 = setQuickFilter(f2, "Contacts", null);
    expect(f3.rules).toEqual([
      userRule,
      expect.objectContaining({ id: "quick:Opportunities" }),
    ]);
    // Original inputs are not mutated.
    expect(base.rules).toHaveLength(1);
  });

  it("ignores groups and non-quick ids when reading the active mode", () => {
    const f: RuleGroupType = {
      combinator: "and",
      rules: [
        { combinator: "or", rules: [] },
        { id: "user-rule", field: "Contacts", operator: "=", value: "2" },
      ],
    };
    expect(getQuickMode(f, "Contacts")).toBeNull();
  });
});
