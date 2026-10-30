// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitDto } from "../../types";
import { HotspotsView } from "./HotspotsView";
import { LimitsView } from "./LimitsView";
import { QueriesView } from "./QueriesView";

const unit: UnitDto = {
  tree: [], exceptions: [],
  hotspots: [{ signature: "Synthetic.handle()", selfNs: 2_000_000, totalNs: 4_000_000, selfBytes: 1024, count: 2 }],
  statements: [
    { kind: "soql", text: "SELECT Id FROM Account WHERE Name = 'A'", rows: 2, durNs: 1_000_000 },
    { kind: "soql", text: "SELECT Id FROM Account WHERE Name = 'B'", rows: 3, durNs: 2_000_000 },
    { kind: "dml", text: "Insert Account", rows: 4, durNs: 500_000 },
  ],
  limits: [{ namespace: "", entries: [
    { name: "SOQL queries", used: 95, max: 100 },
    { name: "DML statements", used: 2, max: 100 },
  ] }],
};

const locales = [
  { language: "en-US", empty: ["No method frames", "No SOQL or DML", "No limit usage"],
    headers: ["Method", "Self", "Total", "Heap", "Calls", "Statement", "Time", "Rows"],
    namespace: "(default)", soqlRows: "5 rows", dmlRows: "4 rows" },
  { language: "zh-CN", empty: ["暂无方法调用帧", "暂无 SOQL 或 DML", "暂无限制使用数据"],
    headers: ["方法", "自身耗时", "总耗时", "堆内存", "调用次数", "语句", "耗时", "行数"],
    namespace: "（默认）", soqlRows: "5 行", dmlRows: "4 行" },
] as const;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe.each(locales)("Log analysis locale / 日志分析语言: $language", (words) => {
  it("localizes empty views / 翻译空视图", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([words.language]);
    render(<><HotspotsView units={[]} /><QueriesView units={[]} /><LimitsView units={[]} /></>);
    for (const message of words.empty) expect(screen.getByText(message)).toBeTruthy();
  });

  it("localizes populated views without altering analysis or navigation / 翻译有数据的视图并保留分析与导航", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([words.language]);
    const onSource = vi.fn();
    const { container } = render(<><HotspotsView units={[unit]} onSource={onSource} /><QueriesView units={[unit]} /><LimitsView units={[unit]} /></>);
    for (const header of words.headers) expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    expect(screen.getByText(words.namespace)).toBeTruthy();
    expect(container.textContent).toContain(words.soqlRows);
    expect(container.textContent).toContain(words.dmlRows);
    expect(screen.getByText("SELECT Id FROM Account WHERE Name = 'A'")).toBeTruthy();
    expect(screen.getByText("Insert Account")).toBeTruthy();
    const rows = screen.getAllByRole("row");
    const repeated = rows.find((row) => row.textContent?.includes("SELECT Id FROM Account"));
    expect(repeated?.className).toContain("text-destructive");
    expect(within(repeated!).getByText("2")).toBeTruthy();
    expect(screen.getByText("95/100 · 95%").className).toContain("text-destructive");
    fireEvent.click(screen.getByRole("button", { name: "Synthetic.handle()" }));
    expect(onSource).toHaveBeenCalledWith({ className: "Synthetic", line: null });
  });
});

it("updates mounted views on language change while retaining data / 切换语言时更新已挂载视图并保留数据", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const onSource = vi.fn();
  render(<><HotspotsView units={[unit]} onSource={onSource} /><QueriesView units={[unit]} /><LimitsView units={[unit]} /></>);
  expect(screen.getByRole("columnheader", { name: "Method" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByRole("columnheader", { name: "方法" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "语句" })).toBeTruthy();
  expect(screen.getByText("（默认）")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Synthetic.handle()" }));
  expect(onSource).toHaveBeenCalledWith({ className: "Synthetic", line: null });
});
