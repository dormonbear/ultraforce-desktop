import type { RuleGroupType, RuleType } from "react-querybuilder";

/** Quick child-presence filter modes (subset of the evaluator's match modes). */
export type QuickMode = "some" | "none";

/** Tag marking a rule as owned by the header quick filter for `column`. */
const quickId = (column: string) => `quick:${column}`;

type MatchRule = RuleType & { match?: { mode: string } };

const isQuickRule = (
  r: RuleGroupType["rules"][number],
  column: string,
): r is MatchRule =>
  typeof r !== "string" && !("rules" in r) && r.id === quickId(column);

/** Active quick-filter mode for `column`, or null. Only top-level rules count. */
export function getQuickMode(
  filter: RuleGroupType,
  column: string,
): QuickMode | null {
  for (const r of filter.rules) {
    if (!isQuickRule(r, column)) continue;
    const mode = r.match?.mode;
    return mode === "some" || mode === "none" ? mode : null;
  }
  return null;
}

/**
 * Copy of `filter` with `column`'s quick rule replaced (or removed when `mode`
 * is null), leaving every other rule untouched. The injected rule leans on the
 * evaluator's empty-subgroup semantics: an empty child group matches every
 * loaded child row, so `some` ⇔ "has any child records" and `none` ⇔ "has
 * none" — no dummy child-field condition needed.
 */
export function setQuickFilter(
  filter: RuleGroupType,
  column: string,
  mode: QuickMode | null,
): RuleGroupType {
  const rules = filter.rules.filter((r) => !isQuickRule(r, column));
  if (mode) {
    rules.push({
      id: quickId(column),
      field: column,
      operator: "=",
      match: { mode },
      value: { combinator: "and", rules: [] },
    } as RuleType);
  }
  return { ...filter, rules };
}
