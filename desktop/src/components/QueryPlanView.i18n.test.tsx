// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { QueryPlanDto } from "../types";
import { QueryPlanView } from "./QueryPlanView";

const plan: QueryPlanDto = {
  sourceQuery: "SELECT Id FROM Account",
  plans: [
    { sobjectType: "Account", leadingOperationType: "TableScan", relativeCost: 2.8, cardinality: 10, sobjectCardinality: 100, fields: [], notes: [{ description: "synthetic note", fields: [], tableEnumOrId: "Account" }] },
    { sobjectType: "Contact", leadingOperationType: "Index", relativeCost: 1, cardinality: 5, sobjectCardinality: 50, fields: [], notes: [] },
  ],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const locale of ["en-US", "zh-CN"] as const) {
  const zh = locale === "zh-CN";
  it(`localizes an empty query plan / 本地化空查询计划: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    render(<QueryPlanView plan={{ ...plan, plans: [] }} onClose={() => {}} />);
    expect(screen.getByText(zh ? "未返回查询计划" : "No plan returned")).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "关闭查询计划" : "Close plan" })).toBeTruthy();
  });

  it(`localizes query-plan headers and preserves data / 本地化查询计划表头并保留数据: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    render(<QueryPlanView plan={plan} onClose={() => {}} />);
    for (const header of zh ? ["对象", "主导操作", "成本", "基数", "对象记录数", "说明"] : ["Object", "Leading operation", "Cost", "Cardinality", "Object rows", "Notes"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(screen.getByText("TableScan")).toBeTruthy();
    expect(screen.getByText("synthetic note")).toBeTruthy();
    expect(screen.getByText("2.80").className).toContain("text-destructive");
    expect(screen.getByText("1.00").className).not.toContain("text-destructive");
  });
}

it("switches labels without losing the plan or close action / 切换标签语言时保留计划及关闭操作", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const onClose = vi.fn();
  render(<QueryPlanView plan={plan} onClose={onClose} />);
  expect(screen.getByRole("columnheader", { name: "Cost" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByText("查询计划")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "成本" })).toBeTruthy();
  expect(screen.getByText("2.80").className).toContain("text-destructive");
  fireEvent.click(screen.getByRole("button", { name: "关闭查询计划" }));
  expect(onClose).toHaveBeenCalledOnce();
});
