// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoqlTab } from "../tabs/types";
import type { SoqlResultDto } from "../types";
import { SoqlView } from "./SoqlPanel";

const ipc = vi.hoisted(() => ({
  count: vi.fn(), run: vi.fn(), cancel: vi.fn(), plan: vi.fn(),
  listen: vi.fn(), error: vi.fn(), info: vi.fn(),
}));
vi.mock("../ipc/soql", () => ({ countSoql: ipc.count, runSoql: ipc.run, cancelSoql: ipc.cancel, queryPlan: ipc.plan }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
vi.mock("sonner", () => ({ toast: { error: ipc.error, info: ipc.info } }));
vi.mock("../org", () => ({ useOrgs: () => ({ selected: "synthetic@example.invalid" }) }));
vi.mock("../hooks/useArrivalCue", () => ({ useArrivalCue: () => 0 }));
vi.mock("react-resizable-panels", () => ({ useDefaultLayout: () => ({}) }));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ResizablePanel: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ResizableHandle: () => null,
}));
vi.mock("../components/SoqlEditor", () => ({
  SoqlEditor: ({ onRun }: { onRun: () => Promise<void> }) => <button onClick={() => void onRun()}>Run test / 运行测试</button>,
}));
vi.mock("../components/ResultTable", () => ({ ResultTable: () => null }));
vi.mock("../components/QueryPlanView", () => ({ QueryPlanView: () => null }));
vi.mock("../components/LogoLoader", () => ({ LogoLoader: () => null }));
vi.mock("../components/CliGuidance", () => ({ CliGuidanceForError: () => null }));
vi.mock("../components/SfErrorDetail", () => ({ SfErrorDetail: () => null }));
vi.mock("../components/motion/MotionDialog", () => ({
  MotionDialog: ({ isOpen, children }: PropsWithChildren<{ isOpen: boolean }>) =>
    isOpen ? <div role="dialog" aria-labelledby="confirmation-title">{children}</div> : null,
}));
vi.mock("@astryxdesign/core/Dialog", () => ({
  DialogHeader: ({ title }: { title: string }) => <h2 id="confirmation-title">{title}</h2>,
}));
vi.mock("@astryxdesign/core/Button", () => ({
  Button: ({ label, onClick }: { label: string; onClick: () => void }) => <button onClick={onClick}>{label}</button>,
}));

const query = "SELECT Id FROM Synthetic__c";
const base: SoqlTab = {
  id: "synthetic", title: "Synthetic / 合成", path: "synthetic.soql", query,
  result: null, error: null, useToolingApi: false, allRows: false, plan: null,
};
const partial: SoqlResultDto = {
  columns: ["Id"], rows: [["synthetic-1"], ["synthetic-2"]],
  totalSize: 4000, done: false, childTables: [],
};
const locales = [
  { language: "en-US", explain: "Explain", idle: "Run a query to see results", empty: "Write a query to run",
    checking: "Checking size…", cancel: "Cancel", large: "Large result set", limit: "Add LIMIT 2,000",
    anyway: "Run anyway", status: "2 of 4,000 rows · cancelled · 1,234 ms", eta: "ETA",
    toast: "Cancelled — showing 2 rows", one: "1 row returned" },
  { language: "zh-CN", explain: "执行计划", idle: "运行查询以查看结果", empty: "请输入要运行的查询",
    checking: "正在检查结果规模…", cancel: "取消", large: "大结果集", limit: "添加 LIMIT 2,000",
    anyway: "仍然运行", status: "4,000 行中已获取 2 行 · 已取消 · 1,234 毫秒", eta: "预计剩余",
    toast: "已取消，显示 2 行", one: "已返回 1 行" },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  ipc.count.mockResolvedValue(null);
  ipc.run.mockResolvedValue({ ...partial, done: true });
  ipc.listen.mockResolvedValue(vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(locales)("SOQL locale / SOQL 语言: $language", (words) => {
  beforeEach(() => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([words.language]);
  });

  it("localizes controls and empty-query feedback / 翻译控件及空查询提示", () => {
    render(<SoqlView tab={{ ...base, query: "  " }} onPatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: words.explain })).toBeTruthy();
    expect(screen.getByText(words.idle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    expect(ipc.error).toHaveBeenCalledWith(words.empty);
    expect(ipc.count).not.toHaveBeenCalled();
  });

  it("keeps preflight cancellation from launching a data query / 取消预检后不启动数据查询", async () => {
    let finish!: (value: null) => void;
    ipc.count.mockReturnValue(new Promise<null>((resolve) => { finish = resolve; }));
    render(<SoqlView tab={base} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    expect(await screen.findByText(words.checking)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: words.cancel }));
    expect(ipc.cancel).toHaveBeenCalledWith(ipc.count.mock.calls[0][0].queryId);
    await act(async () => finish(null));
    await waitFor(() => expect(screen.queryByText(words.checking)).toBeNull());
    expect(ipc.run).not.toHaveBeenCalled();
  });

  it("localizes the large-result guard while preserving literal SOQL / 翻译大结果集保护并保留 SOQL 原文", async () => {
    ipc.count.mockResolvedValue(10000);
    render(<SoqlView tab={base} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    expect(await screen.findByRole("dialog", { name: words.large })).toBeTruthy();
    expect(screen.getByRole("button", { name: words.cancel })).toBeTruthy();
    expect(screen.getByRole("button", { name: words.anyway })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: words.limit }));
    await waitFor(() => expect(ipc.run).toHaveBeenCalledWith(expect.objectContaining({
      query: `${query}\nLIMIT 2000`, org: "synthetic@example.invalid",
    })));
  });

  it("formats result counts, cancellation and elapsed time / 格式化结果数量、取消状态及耗时", () => {
    const view = render(<SoqlView tab={{ ...base, result: partial, lastMs: 1234 }} onPatch={vi.fn()} />);
    expect(screen.getByText(words.status)).toBeTruthy();
    view.rerender(<SoqlView tab={{ ...base, result: { ...partial, totalSize: 1, done: true } }} onPatch={vi.fn()} />);
    expect(screen.getByText(words.one)).toBeTruthy();
  });

  it("localizes live progress and the partial-result toast / 翻译实时进度及部分结果提示", async () => {
    let finish!: (value: SoqlResultDto) => void;
    ipc.run.mockReturnValue(new Promise<SoqlResultDto>((resolve) => { finish = resolve; }));
    render(<SoqlView tab={base} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.run).toHaveBeenCalled());
    act(() => ipc.listen.mock.calls[0][1]({ payload: {
      id: ipc.run.mock.calls[0][0].queryId, fetched: 2, total: 4000,
    } }));
    expect(screen.getByText((text) => text.includes(words.eta))).toBeTruthy();
    await act(async () => finish(partial));
    await waitFor(() => expect(ipc.info).toHaveBeenCalledWith(words.toast));
  });
});

it("updates mounted query messages after a system language change / 系统语言变化后更新已挂载查询消息", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<SoqlView tab={{ ...base, query: "" }} onPatch={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Explain" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByRole("button", { name: "执行计划" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
  expect(ipc.error).toHaveBeenCalledWith("请输入要运行的查询");
});
