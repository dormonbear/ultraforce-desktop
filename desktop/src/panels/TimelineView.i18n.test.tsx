// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UnitDto } from "../types";
import { TimelineView } from "./TimelineView";

const source = { className: "Fixture", line: 12 };
const units: UnitDto[] = [{
  tree: [{ label: "METHOD_ENTRY", detail: "Fixture.run", startNs: 0, durNs: 1_000_000, selfNs: 1_000_000, children: [], source }],
  hotspots: [], statements: [], limits: [], exceptions: [],
}];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

for (const locale of ["en-US", "zh-CN"] as const) {
  const labels = locale === "zh-CN" ? {
    empty: "无执行树", instructions: "滚动缩放 · 拖动平移", reset: "重置缩放",
    select: "选择火焰块以查看时间与源码详情。",
  } : {
    empty: "No execution tree", instructions: "Scroll to zoom · drag to pan", reset: "Reset zoom",
    select: "Select a flame block to inspect timing and source details.",
  };
  it(`localizes the empty timeline / 本地化空时间线: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    render(<TimelineView units={[]} />);
    expect(screen.getByText(labels.empty)).toBeTruthy();
  });
  it(`localizes timeline controls / 本地化时间线控件: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    render(<TimelineView units={units} />);
    expect(screen.getByLabelText(labels.instructions)).toBeTruthy();
    expect(screen.getByText(locale === "zh-CN" ? labels.instructions : "scroll to zoom · drag to pan")).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.reset })).toBeTruthy();
    expect(screen.getByText(labels.select)).toBeTruthy();
  });
}

it("updates selected details on language change and preserves source navigation / 切换语言时更新选中详情并保留源码导航", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const onSource = vi.fn();
  const { container } = render(<TimelineView units={units} onSource={onSource} />);
  const canvas = container.querySelector("canvas")!;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 18, width: 200, height: 18, toJSON: () => ({}),
  });
  fireEvent.click(canvas, { clientX: 50, clientY: 4 });
  for (const label of ["start +0 ns", "end +1.00 ms", "duration 1.00 ms", "depth 0"]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(screen.getByRole("button", { name: "Open source" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  for (const label of ["开始 +0 ns", "结束 +1.00 ms", "时长 1.00 ms", "深度 0"]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: "打开源码" }));
  expect(onSource).toHaveBeenCalledExactlyOnceWith(source);
});
