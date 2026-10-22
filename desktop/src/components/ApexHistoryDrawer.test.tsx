// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApexHistoryEntry } from "../apexHistory";
import { ApexHistoryDrawer } from "./ApexHistoryDrawer";

const history = vi.hoisted(() => ({ list: vi.fn(), clear: vi.fn(), subscribe: vi.fn(), copy: vi.fn() }));
vi.mock("../apexHistory", () => ({ listApexHistory: history.list, clearApexHistory: history.clear, onApexHistory: history.subscribe }));
vi.mock("../clipboard", () => ({ copyText: history.copy }));
vi.mock("./LogView", () => ({ LogView: ({ raw }: { raw: string }) => <pre>{raw}</pre> }));
const source = "\nSystem.debug('RAW_{count}');";
const rawError = "RAW_SF_ERROR_{error}";
const now = new Date(2030, 0, 2, 12).getTime();
function entry(overrides: Partial<ApexHistoryEntry> = {}): ApexHistoryEntry {
  return { id: "synthetic", org: "synthetic@example.invalid", source, logs: "", compiled: true, success: true, exceptionMessage: null, at: now - 30_000, ...overrides };
}
async function mount(entries: ApexHistoryEntry[] = []) {
  history.list.mockResolvedValue(entries);
  const onLoad = vi.fn(), onOpenChange = vi.fn();
  render(<ApexHistoryDrawer open onLoad={onLoad} onOpenChange={onOpenChange} />);
  await act(async () => {});
  return { onLoad, onOpenChange };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now);
  history.subscribe.mockReturnValue(() => {});
  history.copy.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const locale of ["en-US", "zh-CN"] as const) {
  const zh = locale === "zh-CN";
  const words = {
    dialog: zh ? "Apex 执行历史" : "Apex execution history",
    empty: zh ? "暂无执行记录" : "No runs yet",
    close: zh ? "关闭历史" : "Close history",
    clear: zh ? "清除历史" : "Clear history",
    load: zh ? "加载" : "Load", copy: zh ? "复制" : "Copy", back: zh ? "返回" : "Back",
  };
  it(`localizes the empty drawer and close action: ${locale} / 本地化空抽屉及关闭操作`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    const { onOpenChange } = await mount();
    expect(screen.getByRole("dialog", { name: words.dialog })).toBeTruthy();
    expect(screen.getByText(words.empty)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: words.close }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it(`localizes detail actions while preserving raw source, error and log: ${locale} / 本地化详情操作并保留原始源码、错误和日志`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    const { onLoad, onOpenChange } = await mount([entry({ success: false, exceptionMessage: rawError, logs: "RAW_LOG_{count}" })]);
    fireEvent.click(screen.getByRole("button", { name: /System.debug/ }));
    expect(screen.getByText(rawError)).toBeTruthy();
    expect(screen.getByText("RAW_LOG_{count}")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: words.copy }));
    expect(history.copy).toHaveBeenCalledExactlyOnceWith(source, zh ? "源码已复制" : "Source copied");
    expect(screen.getByRole("button", { name: words.back })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: words.load }));
    expect(onLoad).toHaveBeenCalledExactlyOnceWith(source);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it(`preserves clearing and history updates: ${locale} / 保留清除操作及历史更新`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    await mount([entry()]);
    fireEvent.click(screen.getByRole("button", { name: words.clear }));
    expect(history.clear).toHaveBeenCalledOnce();
    const listener: (entries: ApexHistoryEntry[]) => void = history.subscribe.mock.calls[0][0];
    act(() => { listener([]); });
    expect(screen.getByText(words.empty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: words.clear })).toBeNull();
  });

  it.each([
    [30_000, "30s ago", "30 秒前"],
    [120_000, "2m ago", "2 分钟前"],
    [7_200_000, "2h ago", "2 小时前"],
  ])(`localizes the existing age buckets: ${locale}, %s / 本地化现有时间分组`, async (age, en, chinese) => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    await mount([entry({ at: now - age, compiled: false, source: "\n  \n" })]);
    expect(screen.getByText(zh ? chinese : en)).toBeTruthy();
    expect(screen.getByText(zh ? "编译错误" : "Compile error")).toBeTruthy();
    expect(screen.getByText(zh ? "（空）" : "(empty)")).toBeTruthy();
  });

  it(`formats older dates using the selected locale: ${locale} / 按所选语言格式化较早日期`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    await mount([entry({ at: now - 2 * 86_400_000 })]);
    expect(screen.getByText(zh ? "2029/12/31" : "12/31/2029")).toBeTruthy();
  });
}

it("updates mounted detail controls on language change without reloading history / 语言变化时更新已挂载详情控件且不重载历史", async () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  await mount([entry()]);
  fireEvent.click(screen.getByRole("button", { name: /System.debug/ }));
  languages.mockReturnValue(["zh-CN"]);
  act(() => { window.dispatchEvent(new Event("languagechange")); });
  expect(screen.getByRole("dialog", { name: "Apex 执行历史" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "加载" })).toBeTruthy();
  expect(history.list).toHaveBeenCalledOnce();
  expect(screen.getByText("System.debug('RAW_{count}');")).toBeTruthy();
});
