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
    case "doesNotBeginWith":
      return !s.toLowerCase().startsWith(target.toLowerCase());
    case "doesNotEndWith":
      return !s.toLowerCase().endsWith(target.toLowerCase());
    case "in":
    case "notIn": {
      // The editor uses comma-separated text; array values retain literal commas. / 编辑器使用逗号分隔文本；数组值保留原始逗号。
      const values = Array.isArray(value)
        ? value.map((item) => String(item ?? ""))
        : target.split(",").map((item) => item.trim());
      const matches = values.some((item) => cmp(v, item) === 0 || s === item);
      return operator === "in" ? matches : !matches;
    }
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

function incompleteChildRule(rule: RuleType): boolean {
  const match = (rule as RuleType & { match?: MatchInfo }).match;
  const value = rule.value;
  return !!match && (value == null || typeof value !== "object" || !Array.isArray((value as { rules?: unknown }).rules));
}

function evaluateGroupResult(group: RuleGroupType, ctx: RowCtx): boolean | undefined {
  // An explicit empty group keeps its existing no-filter behavior. / 显式空分组保留原有不筛选行为。
  if (group.rules.length === 0) return true;
  // Skip unfinished child rules before combinators and negation. / 在组合及取反前跳过未完成的子规则。
  const results: boolean[] = [];
  for (const rule of group.rules) {
    if (typeof rule === "string") results.push(true);
    else if ("rules" in rule) {
      const nested = evaluateGroupResult(rule, ctx);
      if (nested !== undefined) results.push(nested);
    } else if (!incompleteChildRule(rule)) results.push(evaluateRule(rule, ctx));
  }
  if (results.length === 0) return undefined;
  const combined =
    group.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
  return group.not ? !combined : combined;
}

/** Evaluate an RQB group against one parent row (+ its typed child tables). / 对父行及其类型化子表计算筛选分组。 */
export function evaluateGroup(group: RuleGroupType, ctx: RowCtx): boolean {
  return evaluateGroupResult(group, ctx) ?? true;
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
