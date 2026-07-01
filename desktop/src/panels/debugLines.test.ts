import { describe, it, expect } from "vitest";
import { collectUserDebug } from "./debugLines";
import type { ExecNodeDto, UnitDto } from "../types";

const node = (label: string, detail: string, children: ExecNodeDto[] = []): ExecNodeDto => ({
  label,
  detail,
  dur_ns: null,
  self_ns: null,
  start_ns: 0,
  children,
  source: null,
});

const unit = (tree: ExecNodeDto[]): UnitDto => ({
  tree,
  hotspots: [],
  statements: [],
  limits: [],
  exceptions: [],
});

describe("collectUserDebug", () => {
  it("collects USER_DEBUG messages in execution order, nested too", () => {
    const tree = [
      node("CODE_UNIT_STARTED", "MyClass.run", [
        node("USER_DEBUG", "[1] | DEBUG | start"),
        node("METHOD_ENTRY", "doWork", [node("USER_DEBUG", "[5] | DEBUG | inner")]),
        node("USER_DEBUG", "[9] | DEBUG | end"),
      ]),
    ];
    expect(collectUserDebug([unit(tree)])).toEqual([
      "[1] | DEBUG | start",
      "[5] | DEBUG | inner",
      "[9] | DEBUG | end",
    ]);
  });

  it("returns nothing when there are no debug statements", () => {
    expect(collectUserDebug([unit([node("METHOD_ENTRY", "x")])])).toEqual([]);
  });
});
