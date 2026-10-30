// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { LogViewDto, UnitDto } from "../../types";
import { LogDetailPane } from "./LogDetailPane";
import type { DetailTab } from "./types";

vi.mock("../TimelineView", () => ({
  TimelineView: ({ onSource }: { onSource?: unknown }) => <div data-testid="timeline" data-source={onSource ? "enabled" : "disabled"} />,
}));
vi.mock("../../components/LogView", () => ({ LogView: ({ raw }: { raw: string }) => <div>{raw}</div> }));
vi.mock("../../components/LogoLoader", () => ({ LogoLoader: () => null }));

const unit: UnitDto = { tree: [], hotspots: [], statements: [], limits: [], exceptions: [] };
const view: LogViewDto = { raw: "Synthetic log / 合成日志", apiVersion: "60.0", units: [unit] };

function Harness({ empty = false, orgless = false, units = [unit], onDebug = () => {} }: {
  empty?: boolean; orgless?: boolean; units?: UnitDto[]; onDebug?: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("raw");
  return <LogDetailPane selectedId={empty || orgless ? null : "1"} view={empty ? null : { ...view, units }}
    viewLoading={false} viewError={null} orgless={orgless} tab={tab} setTab={setTab}
    sourceLines={new Set()} onSource={() => {}} onOpenDebug={onDebug} />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const locale of ["en-US", "zh-CN"] as const) {
  const zh = locale === "zh-CN";
  it(`localizes empty log detail / 本地化空日志详情: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    render(<Harness empty />);
    expect(screen.getByText(zh ? "日志详情" : "Log detail")).toBeTruthy();
    expect(screen.getByText(zh ? "请选择日志" : "Select a log")).toBeTruthy();
  });
  it(`localizes log-detail controls / 本地化日志详情控件: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    const onDebug = vi.fn();
    render(<Harness onDebug={onDebug} />);
    expect(screen.getByText(zh ? "API 60.0 · 1 个执行单元" : "API 60.0 · 1 unit")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: zh ? "日志详情视图" : "Log detail view" })).toBeTruthy();
    for (const label of zh ? ["原始", "洞察", "时间线", "热点", "查询", "限制"] : ["Raw", "Insights", "Timeline", "Hotspots", "Queries", "Limits"]) {
      expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: zh ? "调试" : "Debug" }));
    expect(onDebug).toHaveBeenCalledOnce();
  });
}

it("preserves a local timeline and its disabled source navigation across language changes / 切换语言时保留本地时间线及禁用的源码导航", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<Harness orgless units={[unit, unit]} />);
  expect(screen.getByText(/local file \(no org — source navigation off\)/)).toBeTruthy();
  expect(screen.getByText("API 60.0 · 2 units")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Timeline" }));
  expect(screen.getByTestId("timeline").getAttribute("data-source")).toBe("disabled");
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByText(/本地文件（无组织，源码导航已关闭）/)).toBeTruthy();
  expect(screen.getByText("API 60.0 · 2 个执行单元")).toBeTruthy();
  expect(screen.getByRole("radio", { name: "时间线", checked: true })).toBeTruthy();
  expect(screen.getByTestId("timeline").getAttribute("data-source")).toBe("disabled");
});
