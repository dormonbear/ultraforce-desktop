import type { RuleGroupType, RuleType } from "react-querybuilder";
import type { ChildTableDto, Scalar } from "../../../types";
import { displayValue } from "../childData";

/** Everything one parent row exposes to the filter. */
export interface RowCtx {
  /** Parent cell display strings, keyed by column. */
  parent: Record<string, string>;
  /** Typed child tables for this row, keyed by relationship. */
  children: ReadonlyMap<string, ChildTableDto>;
}

const NUM = /^-?\d+(\.\d+)?$/;

/** 3-way compare; numeric when both sides are numbers, else string. null = incomparable. */
function cmp(v: Scalar, target: string): number | null {
  const s = displayValue(v);
  if (s === "" || target === "") return null;
  if ((typeof v === "number" || NUM.test(s)) && NUM.test(target)) {
    return Number(s) - Number(target);
  }
  return s < target ? -1 : s > target ? 1 : 0;
}

// fallow-ignore-next-line complexity
function testOp(v: Scalar, operator: string, value: unknown): boolean {
  const s = displayValue(v);
  const target = typeof value === "string" ? value : String(value ?? "");
  switch (operator) {
    case "=":
      return cmp(v, target) === 0 || s === target;
    case "!=":
      return !(cmp(v, target) === 0 || s === target);
    case "<": {
      const c = cmp(v, target);
      return c !== null && c < 0;
    }
    case "<=": {
      const c = cmp(v, target);
      return c !== null && c <= 0;
    }
    case ">": {
      const c = cmp(v, target);
      return c !== null && c > 0;
    }
    case ">=": {
      const c = cmp(v, target);
      return c !== null && c >= 0;
    }
    case "contains":
      return s.toLowerCase().includes(target.toLowerCase());
    case "doesNotContain":
      return !s.toLowerCase().includes(target.toLowerCase());
    case "beginsWith":
      return s.toLowerCase().startsWith(target.toLowerCase());
    case "endsWith":
      return s.toLowerCase().endsWith(target.toLowerCase());
    case "null":
      return v == null || s === "";
    case "notNull":
      return !(v == null || s === "");
    case "between":
    case "notBetween": {
      const [lo = "", hi = ""] = target.split(",").map((p) => p.trim());
      const cl = cmp(v, lo);
      const ch = cmp(v, hi);
      const inside = cl !== null && ch !== null && cl >= 0 && ch <= 0;
      return operator === "between" ? inside : !inside;
    }
    default:
      // Unknown operator: pass — never hide rows on unsupported input.
      return true;
  }
}

type MatchInfo = { mode: string; threshold?: number };

/** Evaluate an RQB group against one parent row (+ its typed child tables). */
export function evaluateGroup(group: RuleGroupType, ctx: RowCtx): boolean {
  // Empty group = no filtering — even nested (an empty `or` would otherwise
  // evaluate [].some() = false and drop every row).
  if (group.rules.length === 0) return true;
  const results = group.rules.map((r) => {
    if (typeof r === "string") return true; // independent-combinator strings: unused here
    if ("rules" in r) return evaluateGroup(r, ctx);
    return evaluateRule(r, ctx);
  });
  const combined =
    group.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
  return group.not ? !combined : combined;
}

// fallow-ignore-next-line complexity
function evaluateRule(rule: RuleType, ctx: RowCtx): boolean {
  const match = (rule as RuleType & { match?: MatchInfo }).match;
  if (match) {
    const entry = ctx.children.get(rule.field);
    const rows = entry?.rows ?? [];
    const cols = entry?.columns ?? [];
    const sub = rule.value as RuleGroupType;
    const m = rows.filter((row) => evalChildRow(sub, cols, row)).length;
    const t = match.threshold ?? 0;
    switch (match.mode) {
      case "some":
        return m > 0;
      case "all":
        return m === rows.length; // vacuously true when no children loaded
      case "none":
        return m === 0;
      case "atLeast":
        return m >= t;
      case "atMost":
        return m <= t;
      case "exactly":
        return m === t;
      default:
        return true;
    }
  }
  return testOp(ctx.parent[rule.field] ?? "", rule.operator, rule.value);
}

/** Evaluate a subquery rule group against one typed child row. */
function evalChildRow(group: RuleGroupType, cols: string[], row: Scalar[]): boolean {
  // Empty group = no filtering (see evaluateGroup).
  if (group.rules.length === 0) return true;
  const results = group.rules.map((r) => {
    if (typeof r === "string") return true;
    if ("rules" in r) return evalChildRow(r, cols, row);
    const i = cols.indexOf(r.field);
    return testOp(i >= 0 ? (row[i] ?? null) : null, r.operator, r.value);
  });
  const combined =
    group.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
  return group.not ? !combined : combined;
}
