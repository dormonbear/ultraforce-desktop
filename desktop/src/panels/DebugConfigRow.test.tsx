// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOG_LEVELS, presetLevels } from "../debug-presets";
import type { LoggingConfigDto } from "../types";
import { DebugConfigRow } from "./DebugConfigRow";

const ipc = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../ipc/config", () => ({ loadLoggingConfig: ipc.load }));
const levels = presetLevels("Apex Only");
let index = 0;
const key = (suffix: string) => `synthetic-${index}-${suffix}`;
function config(name: string): LoggingConfigDto {
  return { traceFlags: [], entities: [], debugLevels: [{ id: name, developerName: name, levels }] };
}
function deferred() {
  let resolve!: (value: LoggingConfigDto) => void, reject!: (error: Error) => void;
  const promise = new Promise<LoggingConfigDto>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush(action?: () => void) { await act(async () => { action?.(); }); }
function row(org: string, open = true) {
  return <DebugConfigRow org={org} value={levels} onApply={vi.fn()} applying={false} error={null} open={open} />;
}
beforeEach(() => { index++; ipc.load.mockReset().mockResolvedValue(config("CURRENT")); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const locale of ["en-US", "zh-CN"] as const) {
  const zh = locale === "zh-CN";
  const labels = zh ? {
    preset: "调试级别预设", refresh: "刷新调试级别", loading: "正在加载…",
    applying: "正在应用…", empty: "暂无调试级别", custom: "自定义", apex: "Apex 代码调试级别",
    headers: ["预设", "Apex 代码", "Apex 性能分析", "外部调用", "数据访问", "数据库", "NBA", "系统", "验证", "Visualforce", "Wave", "工作流"],
  } : {
    preset: "Debug level preset", refresh: "Refresh debug levels", loading: "Loading…",
    applying: "Applying…", empty: "No debug levels", custom: "Custom", apex: "Apex Code debug level",
    headers: ["Preset", "Apex Code", "Apex Profiling", "Callout", "Data Access", "Database", "Nba", "System", "Validation", "Visualforce", "Wave", "Workflow"],
  };

  it(`localizes controls and preserves org values / 本地化控件并保留组织值: ${locale}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    const pending = deferred(); ipc.load.mockReturnValueOnce(pending.promise);
    const onApply = vi.fn(), selected = presetLevels("Full Debugging");
    render(<DebugConfigRow org={key("localized")} value={levels} onApply={onApply} applying error="RAW_ERROR {error}$&" open />);
    expect(screen.getByRole("combobox", { name: labels.preset }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("option", { name: labels.loading })).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.refresh }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(labels.applying)).toBeTruthy();
    expect(screen.getByText("RAW_ERROR {error}$&")).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(labels.headers);
    await flush(() => pending.resolve({ ...config("CURRENT"), debugLevels: [
      { id: "CURRENT", developerName: "RAW_{tool}_$&", levels },
      { id: "SECOND", developerName: "SECOND_RAW", levels: selected },
    ] }));
    expect(screen.getByRole("option", { name: "RAW_{tool}_$&" })).toBeTruthy();
    const category = screen.getByRole("combobox", { name: labels.apex });
    expect(Array.from(category.querySelectorAll("option")).map(option => option.value)).toEqual(LOG_LEVELS);
    fireEvent.change(category, { target: { value: "INFO" } });
    expect(onApply).toHaveBeenLastCalledWith({ ...levels, apexCode: "INFO" });
    fireEvent.change(screen.getByRole("combobox", { name: labels.preset }), { target: { value: "SECOND" } });
    expect(onApply).toHaveBeenLastCalledWith(selected);
  });

  it(`localizes empty and custom presets / 本地化空预设和自定义预设: ${locale}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    ipc.load.mockResolvedValueOnce({ ...config("EMPTY"), debugLevels: [] });
    render(row(key("empty"))); await flush();
    expect(screen.getByRole("option", { name: labels.empty })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: labels.preset }).hasAttribute("disabled")).toBe(true);
    ipc.load.mockResolvedValueOnce({ ...config("OTHER"), debugLevels: [
      { id: "OTHER", developerName: "OTHER_RAW", levels: presetLevels("None") },
    ] });
    fireEvent.click(screen.getByRole("button", { name: labels.refresh })); await flush();
    expect(screen.getByRole("option", { name: labels.custom })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: labels.preset }).hasAttribute("disabled")).toBe(false);
  });
}

it("updates mounted debug controls without reloading org data / 更新已挂载调试控件而不重载组织数据", async () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(row(key("language"))); await flush();
  expect(screen.getByRole("combobox", { name: "Apex Code debug level" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByRole("combobox", { name: "Apex 代码调试级别" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "刷新调试级别" })).toBeTruthy();
  expect(ipc.load).toHaveBeenCalledTimes(1);
});

it("loads current org presets and reuses a completed cache / 加载当前组织预设并复用已完成缓存", async () => {
  const org = key("a"); const { rerender } = render(row(org)); await flush();
  expect(ipc.load).toHaveBeenCalledExactlyOnceWith(org);
  expect(screen.getByRole("option", { name: "CURRENT" })).toBeTruthy();
  rerender(row(org, false)); rerender(row(org)); await flush();
  expect(ipc.load).toHaveBeenCalledTimes(1);
});

it("hides old org presets while loading a new org / 新组织加载时隐藏旧组织预设", async () => {
  ipc.load.mockResolvedValueOnce(config("OLD"));
  const { rerender } = render(row(key("a"))); await flush();
  const current = deferred(); ipc.load.mockReturnValueOnce(current.promise);
  rerender(row(key("b")));
  expect(screen.queryByRole("option", { name: "OLD" })).toBeNull();
  expect(screen.getByRole("combobox", { name: "Debug level preset" }).hasAttribute("disabled")).toBe(true);
  await flush(() => current.resolve(config("CURRENT")));
});

it("ignores late records from the previous org / 忽略前一组织迟到的记录", async () => {
  const old = deferred(); ipc.load.mockReturnValueOnce(old.promise);
  const { rerender } = render(row(key("a"))); rerender(row(key("b"))); await flush();
  await flush(() => old.resolve(config("OLD")));
  expect(screen.queryByRole("option", { name: "OLD" })).toBeNull();
  expect(screen.getByRole("option", { name: "CURRENT" })).toBeTruthy();
});

it("ignores late errors from the previous org / 忽略前一组织迟到的错误", async () => {
  const old = deferred(); ipc.load.mockReturnValueOnce(old.promise);
  const { rerender } = render(row(key("a"))); rerender(row(key("b"))); await flush();
  await flush(() => old.reject(new Error("OLD_ERROR / 旧错误")));
  expect(screen.queryByText("OLD_ERROR / 旧错误")).toBeNull();
});

it("does not let an earlier visit poison the current org cache / 不让更早访问污染当前组织缓存", async () => {
  const old = deferred(); ipc.load.mockReturnValueOnce(old.promise);
  const a = key("a"), b = key("b");
  const { rerender } = render(row(a)); rerender(row(b)); await flush();
  rerender(row(a)); await flush();
  await flush(() => old.resolve(config("OLD")));
  expect(screen.queryByRole("option", { name: "OLD" })).toBeNull();
  rerender(row(a, false)); rerender(row(a)); await flush();
  expect(screen.queryByRole("option", { name: "OLD" })).toBeNull();
  expect(screen.getByRole("option", { name: "CURRENT" })).toBeTruthy();
});

it("ignores closed-view requests and reloads on reopen / 忽略已关闭视图的请求并在重新打开时加载", async () => {
  const old = deferred(); ipc.load.mockReturnValueOnce(old.promise);
  const org = key("a"), { rerender } = render(row(org)); rerender(row(org, false));
  await flush(() => old.resolve(config("OLD")));
  rerender(row(org)); await flush();
  expect(ipc.load).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("option", { name: "OLD" })).toBeNull();
});

it("preserves current errors and refresh recovery / 保留当前错误及刷新恢复", async () => {
  ipc.load.mockRejectedValueOnce(new Error("CURRENT_ERROR / 当前错误"));
  render(row(key("a"))); await flush();
  expect(screen.getByText("CURRENT_ERROR / 当前错误")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh debug levels" })); await flush();
  expect(screen.queryByText("CURRENT_ERROR / 当前错误")).toBeNull();
  expect(screen.getByRole("option", { name: "CURRENT" })).toBeTruthy();
});

it("clears a previous refresh error when reopening a valid cache / 重开有效缓存时清除之前的刷新错误", async () => {
  const org = key("a"), { rerender } = render(row(org)); await flush();
  ipc.load.mockRejectedValueOnce(new Error("REFRESH_ERROR / 刷新错误"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh debug levels" })); await flush();
  expect(screen.getByText("REFRESH_ERROR / 刷新错误")).toBeTruthy();
  rerender(row(org, false)); rerender(row(org)); await flush();
  expect(screen.queryByText("REFRESH_ERROR / 刷新错误")).toBeNull();
  expect(screen.getByRole("option", { name: "CURRENT" })).toBeTruthy();
});

it("shows a current read error without fetching presets / 显示当前读取错误且不获取预设", async () => {
  render(<DebugConfigRow org={key("a")} value={null} onApply={vi.fn()} applying={false} error="CURRENT_READ_ERROR / 当前读取错误" open={false} />);
  await flush();
  expect(screen.getByRole("alert").textContent).toBe("CURRENT_READ_ERROR / 当前读取错误");
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(ipc.load).not.toHaveBeenCalled();
});

it("waits for current levels before loading an open row / 等待当前级别就绪后再加载打开的行", async () => {
  render(<DebugConfigRow org={key("a")} value={null} onApply={vi.fn()} applying={false} error={null} open />);
  await flush();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(ipc.load).not.toHaveBeenCalled();
});

it("applies an org preset and forces refresh / 应用组织预设并强制刷新", async () => {
  const selected = presetLevels("Full Debugging"), onApply = vi.fn();
  ipc.load.mockResolvedValueOnce({ ...config("FIRST"), debugLevels: [
    { id: "FIRST", developerName: "FIRST", levels },
    { id: "SECOND", developerName: "SECOND", levels: selected },
  ] });
  const org = key("a");
  render(<DebugConfigRow org={org} value={levels} onApply={onApply} applying={false} error={null} open />);
  await flush();
  fireEvent.change(screen.getByRole("combobox", { name: "Debug level preset" }), { target: { value: "SECOND" } });
  expect(onApply).toHaveBeenCalledExactlyOnceWith(selected);
  fireEvent.click(screen.getByRole("button", { name: "Refresh debug levels" })); await flush();
  expect(ipc.load).toHaveBeenCalledTimes(2);
  expect(ipc.load).toHaveBeenLastCalledWith(org);
});
