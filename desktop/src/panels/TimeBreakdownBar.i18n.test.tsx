// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExecNodeDto, UnitDto } from "../types";
import { TimeBreakdownBar } from "./TimeBreakdownBar";

const node = (label: string, selfNs: number): ExecNodeDto => ({
  label, selfNs, durNs: selfNs, detail: "", startNs: 0, source: null, children: [],
});
const unit: UnitDto = {
  tree: [node("METHOD_ENTRY", 1_000_000), node("SOQL_EXECUTE", 2_000_000), node("DML_BEGIN", 3_000_000), node("CALLOUT_REQUEST", 4_000_000), node("OTHER", 5_000_000)],
  hotspots: [], statements: [], limits: [], exceptions: [],
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("translates legend and accessible labels while preserving timings / 翻译图例与无障碍标签并保留耗时", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<TimeBreakdownBar units={[unit]} />);
  expect(screen.getByLabelText("Callout · 4.00 ms · 26.7%")).toBeTruthy();
  expect(screen.getByLabelText("Other · 5.00 ms · 33.3%")).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByText("外部调用")).toBeTruthy();
  expect(screen.getByText("其他")).toBeTruthy();
  expect(screen.getByLabelText("外部调用 · 4.00 ms · 26.7%")).toBeTruthy();
  expect(screen.getByLabelText("其他 · 5.00 ms · 33.3%")).toBeTruthy();
  expect(screen.getByText("Apex")).toBeTruthy();
  expect(screen.getByText("SOQL")).toBeTruthy();
  expect(screen.getByText("DML")).toBeTruthy();
});
