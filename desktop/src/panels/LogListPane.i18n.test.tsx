// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { LogRefDto } from "../types";
import { APEX_LOG_ACCESS_HINT } from "../errorFormat";
import { filterLogs } from "./logList";
import { LogListPane } from "./LogListPane";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 57,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 57 })),
    measureElement: () => {},
  }),
}));

const logs: LogRefDto[] = [
  { id: "1", operation: "Synthetic first", status: "Success", startTime: "", application: "", user: "Ada", durationMs: 12, logLength: 20 },
  { id: "2", operation: "Synthetic second", status: "Error", startTime: "", application: "", user: "Lin", durationMs: 20, logLength: 30 },
];
const trace = { tracing: false, tracingBusy: false, traceExpiry: null, traceMinsLeft: 1, quickSelfTrace: vi.fn() };

function Harness({ empty = false, listError = null }: { empty?: boolean; listError?: string | null }) {
  const [filter, setFilter] = useState({ query: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = empty ? [] : logs;
  return <LogListPane logs={rows} visibleLogs={filterLogs(rows, filter)} listError={listError} listLoading={false}
    filter={filter} setFilter={setFilter} selectedId={selectedId} cachedIds={new Set(["1"])} dragOver
    trace={trace} onRefresh={() => {}} onOpenConfig={() => {}} onSelect={setSelectedId} onSaveLog={() => {}} />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const locale of ["en-US", "zh-CN"] as const) {
  it(`localizes empty list and toolbar / 本地化空列表和工具栏: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    render(<Harness empty />);
    const zh = locale === "zh-CN";
    expect(screen.getByText(zh ? "暂无调试日志。请设置跟踪标志，然后刷新以获取日志。" : "No debug logs yet. Set a trace flag, then refresh to fetch them.")).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "配置日志" : "Configure logging" })).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "为自己跟踪 30 分钟" : "Trace myself for 30 minutes" })).toBeTruthy();
    expect(screen.getByText(zh ? "拖入 .log 文件以查看" : "Drop a .log file to view")).toBeTruthy();
  });
}

it("retains filter and selection when the language changes / 切换语言时保留筛选与选中项", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: /Synthetic first/ }));
  fireEvent.change(screen.getByLabelText("Filter logs"), { target: { value: "Ada" } });
  expect(screen.getByRole("button", { name: /Synthetic first/ }).className).toContain("bg-primary/10");
  expect(screen.getByLabelText("Cached locally")).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect((screen.getByLabelText("筛选日志列表") as HTMLInputElement).value).toBe("Ada");
  expect(screen.getByRole("button", { name: /Synthetic first/ }).className).toContain("bg-primary/10");
  expect(screen.getByLabelText("已缓存到本地")).toBeTruthy();
  expect(screen.getByText("成功")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("筛选日志列表"), { target: { value: "missing" } });
  expect(screen.getByText("没有日志匹配此筛选条件。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getByRole("button", { name: /Synthetic second/ })).toBeTruthy();
  expect(screen.getByText("失败")).toBeTruthy();
});

it("localizes active trace countdown / 本地化进行中的跟踪倒计时", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  render(<LogListPane logs={[]} visibleLogs={[]} listError={null} listLoading={false}
    filter={{ query: "" }} setFilter={() => {}} selectedId={null} cachedIds={new Set()} dragOver={false}
    trace={{ ...trace, tracing: true, traceExpiry: "2099-01-01T00:00:00Z", traceMinsLeft: 12 }}
    onRefresh={() => {}} onOpenConfig={() => {}} onSelect={() => {}} onSaveLog={() => {}} />);
  expect(screen.getByRole("button", { name: "正在跟踪您，剩余 12 分钟；点击延长" })).toBeTruthy();
  expect(screen.getByText("跟踪中 · 12 分钟")).toBeTruthy();
});

it("switches log-access guidance while preserving other errors / 切换日志访问提示语言并保留其他错误", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const { rerender } = render(<Harness listError={APEX_LOG_ACCESS_HINT} />);
  expect(screen.getByText(APEX_LOG_ACCESS_HINT)).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByText(/此组织用户无法查看调试日志/)).toBeTruthy();
  expect(screen.getByText(/"View All Data"（查看所有数据）权限/)).toBeTruthy();
  rerender(<Harness listError="Synthetic backend error / 合成后端错误" />);
  expect(screen.getByText("Synthetic backend error / 合成后端错误")).toBeTruthy();
});
