// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoqlTab } from "../tabs/types";
import type { SoqlResultDto } from "../types";
import { SoqlView } from "./SoqlPanel";

const ipc = vi.hoisted(() => ({
  count: vi.fn(), run: vi.fn(), cancel: vi.fn(), plan: vi.fn(),
  listen: vi.fn(), error: vi.fn(), info: vi.fn(), unhandled: vi.fn(),
  org: "synthetic@example.invalid",
}));
vi.mock("../ipc/soql", () => ({ countSoql: ipc.count, runSoql: ipc.run, cancelSoql: ipc.cancel, queryPlan: ipc.plan }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
vi.mock("sonner", () => ({ toast: { error: ipc.error, info: ipc.info } }));
vi.mock("../org", () => ({ useOrgs: () => ({ selected: ipc.org }) }));
vi.mock("../hooks/useArrivalCue", () => ({ useArrivalCue: () => 0 }));
vi.mock("react-resizable-panels", () => ({ useDefaultLayout: () => ({}) }));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ResizablePanel: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ResizableHandle: () => null,
}));
vi.mock("../components/SoqlEditor", () => ({
  SoqlEditor: ({ onRun, running }: { onRun: () => Promise<void>; running: boolean }) =>
    <button disabled={running} onClick={() => void onRun().catch(ipc.unhandled)}>Run test / 运行测试</button>,
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
  ipc.org = "synthetic@example.invalid";
  ipc.count.mockResolvedValue(null);
  ipc.run.mockResolvedValue({ ...partial, done: true });
  ipc.listen.mockResolvedValue(vi.fn());
  ipc.cancel.mockResolvedValue(undefined);
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("SOQL request ownership / SOQL 请求归属", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  });

  it("does not launch an old preflight after the organization changes / 组织改变后不启动旧预检的数据查询", async () => {
    const count = deferred<null>();
    ipc.count.mockReturnValue(count.promise);
    const onPatch = vi.fn();
    const view = render(<SoqlView tab={base} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    expect(ipc.count).toHaveBeenCalledTimes(1);
    ipc.org = "other@example.invalid";
    view.rerender(<SoqlView tab={base} onPatch={onPatch} />);
    await act(async () => count.resolve(null));
    expect(ipc.run).not.toHaveBeenCalled();
    expect(screen.queryByText("Checking size…")).toBeNull();
  });

  it("ignores a completed data query after its view is disposed / 视图销毁后忽略完成的数据查询", async () => {
    const result = deferred<SoqlResultDto>();
    const unlisten = vi.fn();
    ipc.run.mockReturnValue(result.promise);
    ipc.listen.mockResolvedValue(unlisten);
    const onPatch = vi.fn();
    const view = render(<SoqlView tab={base} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.run).toHaveBeenCalledTimes(1));
    onPatch.mockClear();
    view.unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
    await act(async () => result.resolve(partial));
    expect(onPatch).not.toHaveBeenCalled();
    expect(ipc.info).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("disposes delayed listener registration without starting a query / 清理延迟的监听注册且不启动查询", async () => {
    const registration = deferred<() => void>();
    const unlisten = vi.fn();
    ipc.listen.mockReturnValue(registration.promise);
    const view = render(<SoqlView tab={base} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.listen).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => registration.resolve(unlisten));
    expect(ipc.run).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("ignores an old explanation after the organization changes / 组织改变后忽略旧执行计划", async () => {
    const plan = deferred<NonNullable<SoqlTab["plan"]>>();
    ipc.plan.mockReturnValue(plan.promise);
    const onPatch = vi.fn();
    const view = render(<SoqlView tab={base} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    ipc.org = "other@example.invalid";
    view.rerender(<SoqlView tab={base} onPatch={onPatch} />);
    await act(async () => plan.reject(new Error("Synthetic old plan / 合成旧计划")));
    expect(ipc.error).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Explain" }).hasAttribute("disabled")).toBe(false);
  });

  it("recovers when progress registration fails / 进度监听注册失败后恢复", async () => {
    ipc.listen.mockRejectedValue(new Error("Synthetic registration failure / 合成注册失败"));
    const onPatch = vi.fn();
    render(<SoqlView tab={base} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run test / 运行测试" }).hasAttribute("disabled")).toBe(false));
    expect(ipc.unhandled).not.toHaveBeenCalled();
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    expect(ipc.run).not.toHaveBeenCalled();
  });

  it("keeps a new organization's query active when the old query settles / 旧查询结束时保持新组织查询的活动状态", async () => {
    const old = deferred<SoqlResultDto>();
    const current = deferred<SoqlResultDto>();
    ipc.run.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const onPatch = vi.fn();
    const view = render(<SoqlView tab={base} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.run).toHaveBeenCalledTimes(1));
    const oldId = ipc.run.mock.calls[0][0].queryId;
    ipc.org = "other@example.invalid";
    view.rerender(<SoqlView tab={base} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.run).toHaveBeenCalledTimes(2));
    expect(ipc.run.mock.calls[1][0].org).toBe(ipc.org);
    expect(ipc.cancel).toHaveBeenCalledWith(oldId);
    const currentId = ipc.run.mock.calls[1][0].queryId;
    act(() => ipc.listen.mock.calls[1][1]({ payload: { id: currentId, fetched: 2, total: 4000 } }));
    act(() => ipc.listen.mock.calls[0][1]({ payload: { id: oldId, fetched: 999, total: 4000 } }));
    expect(screen.getByText(/2 \/ 4,000/)).toBeTruthy();
    expect(screen.queryByText(/999 \/ 4,000/)).toBeNull();
    onPatch.mockClear();
    await act(async () => old.resolve(partial));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText(/2 \/ 4,000/)).toBeTruthy();
    await act(async () => current.resolve({ ...partial, done: true }));
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ done: true }) }));
  });

  it("preserves the mounted editor while changing request ownership / 改变请求归属时保留已挂载编辑器", () => {
    const onPatch = vi.fn();
    const view = render(<SoqlView tab={base} onPatch={onPatch} />);
    const editorButton = screen.getByRole("button", { name: "Run test / 运行测试" });
    ipc.org = "other@example.invalid";
    view.rerender(<SoqlView tab={base} onPatch={onPatch} />);
    expect(screen.getByRole("button", { name: "Run test / 运行测试" })).toBe(editorButton);
  });

  it("cancels during delayed registration without launching a query / 延迟注册期间取消后不启动查询", async () => {
    const registration = deferred<() => void>();
    const unlisten = vi.fn();
    ipc.listen.mockReturnValue(registration.promise);
    render(<SoqlView tab={base} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.listen).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => registration.resolve(unlisten));
    expect(ipc.run).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Run test / 运行测试" }).hasAttribute("disabled")).toBe(false);
  });

  it("dismisses a large-result guard and permits another preflight / 关闭大结果集保护后允许再次预检", async () => {
    ipc.count.mockResolvedValue(10000);
    render(<SoqlView tab={base} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.count).toHaveBeenCalledTimes(2));
    expect(ipc.run).not.toHaveBeenCalled();
  });

  it("runs the guarded query snapshot if editor options change / 编辑器选项改变后仍执行已保护的查询快照", async () => {
    ipc.count.mockResolvedValue(10000);
    const onPatch = vi.fn();
    const view = render(<SoqlView tab={base} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await screen.findByRole("dialog");
    view.rerender(<SoqlView tab={{ ...base, query: "SELECT Name FROM Other__c", allRows: true, useToolingApi: true }} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Run anyway" }));
    await waitFor(() => expect(ipc.run).toHaveBeenCalledWith(expect.objectContaining({ query, allRows: false, useToolingApi: false })));
  });

  it("permits retry after an active cancellation fails / 当前取消失败后允许重试", async () => {
    const result = deferred<SoqlResultDto>();
    ipc.run.mockReturnValue(result.promise);
    ipc.cancel.mockRejectedValueOnce(new Error("Synthetic cancel failure / 合成取消失败"));
    render(<SoqlView tab={base} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.run).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(ipc.error).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(ipc.cancel).toHaveBeenCalledTimes(2);
    await act(async () => result.resolve(partial));
    expect(ipc.info).toHaveBeenCalledWith("Cancelled — showing 2 rows");
  });

  it("ignores cancellation failure after the organization changes / 组织改变后忽略取消失败", async () => {
    const result = deferred<SoqlResultDto>();
    const cancellation = deferred<void>();
    ipc.run.mockReturnValue(result.promise);
    ipc.cancel.mockReturnValue(cancellation.promise);
    const onPatch = vi.fn();
    const view = render(<SoqlView tab={base} onPatch={onPatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Run test / 运行测试" }));
    await waitFor(() => expect(ipc.run).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    ipc.org = "other@example.invalid";
    view.rerender(<SoqlView tab={base} onPatch={onPatch} />);
    onPatch.mockClear();
    await act(async () => cancellation.reject(new Error("Synthetic old cancellation / 合成旧取消")));
    await act(async () => result.resolve(partial));
    expect(ipc.error).not.toHaveBeenCalled();
    expect(onPatch).not.toHaveBeenCalled();
  });
});
