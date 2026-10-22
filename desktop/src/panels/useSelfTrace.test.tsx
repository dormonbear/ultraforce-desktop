// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { presetLevels } from "../debug-presets";
import type { DebugConfigDto } from "../types";
import { useSelfTrace } from "./useSelfTrace";

const ipc = vi.hoisted(() => ({ get: vi.fn(), trace: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../ipc/config", () => ({ getDebugConfig: ipc.get, quickSelfTrace: ipc.trace }));
vi.mock("sonner", () => ({ toast: { success: ipc.success, error: ipc.error } }));
const A = "a@example.invalid", B = "b@example.invalid";
const expiry = "2099-01-01T00:00:00Z";
const dto = (expirationDate: string | null = null): DebugConfigDto => ({
  expirationDate, levels: presetLevels("Apex Only"), traceFlagId: "synthetic",
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush(action?: () => void) { await act(async () => { action?.(); }); }
function mount() {
  return renderHook(({ org }) => useSelfTrace(org), { initialProps: { org: A } });
}
beforeEach(() => {
  vi.resetAllMocks();
  ipc.get.mockResolvedValue(dto());
  ipc.trace.mockResolvedValue(dto(expiry));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("loads and extends the selected org trace / 加载并延长所选组织的跟踪", async () => {
  const { result } = mount(); await flush();
  await act(async () => { await result.current.quickSelfTrace(); });
  expect(ipc.get).toHaveBeenCalledExactlyOnceWith(A);
  expect(ipc.trace).toHaveBeenCalledExactlyOnceWith(30, A);
  expect(result.current).toMatchObject({ traceExpiry: expiry, tracing: true, tracingBusy: false });
  expect(ipc.success).toHaveBeenCalledOnce();
});

it("clears the previous org trace while loading another org / 加载其他组织时清除前一组织跟踪", async () => {
  ipc.get.mockResolvedValueOnce(dto(expiry));
  const current = deferred<DebugConfigDto>();
  const { result, rerender } = mount(); await flush();
  ipc.get.mockReturnValueOnce(current.promise); rerender({ org: B });
  expect(result.current).toMatchObject({ traceExpiry: null, tracing: false, tracingBusy: false });
  await flush(() => current.resolve(dto()));
});

it("ignores a previous org read after current success / 当前读取成功后忽略前一组织读取", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount(); rerender({ org: B }); await flush();
  await flush(() => old.resolve(dto(expiry)));
  expect(result.current.traceExpiry).toBeNull();
});

it("rejects a previous visit when returning to the same org / 返回相同组织时拒绝前次访问结果", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount(); rerender({ org: B }); await flush();
  rerender({ org: A }); await flush();
  await flush(() => old.resolve(dto(expiry)));
  expect(result.current.traceExpiry).toBeNull();
});

it("keeps an older read from replacing a completed extension / 防止较早读取替换已完成的跟踪延长", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result } = mount();
  await act(async () => { await result.current.quickSelfTrace(); });
  await flush(() => old.resolve(dto()));
  expect(result.current.traceExpiry).toBe(expiry);
});

it("clears old busy state and ignores obsolete write feedback / 清除旧忙碌状态并忽略过期写入反馈", async () => {
  const old = deferred<DebugConfigDto>(); ipc.trace.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount(); await flush();
  act(() => { void result.current.quickSelfTrace(); });
  rerender({ org: B }); await flush();
  expect(result.current.tracingBusy).toBe(false);
  await flush(() => old.resolve(dto(expiry)));
  expect(result.current.traceExpiry).toBeNull();
  expect(ipc.success).not.toHaveBeenCalled();
});

it("ignores obsolete write errors / 忽略过期写入错误", async () => {
  const old = deferred<DebugConfigDto>(); ipc.trace.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount(); await flush();
  act(() => { void result.current.quickSelfTrace(); }); rerender({ org: B }); await flush();
  await flush(() => old.reject(new Error("OLD_ORG_ERROR")));
  expect(ipc.error).not.toHaveBeenCalled();
});

it("drops pending feedback after unmount / 卸载后丢弃等待中的反馈", async () => {
  const old = deferred<DebugConfigDto>(); ipc.trace.mockReturnValueOnce(old.promise);
  const { result, unmount } = mount(); await flush();
  act(() => { void result.current.quickSelfTrace(); }); unmount();
  await flush(() => old.reject(new Error("UNMOUNTED_ERROR")));
  expect(ipc.error).not.toHaveBeenCalled();
});

it("does not start writes from an obsolete callback / 不从过期回调发起写入", async () => {
  const { result, rerender } = mount(); await flush();
  const previous = result.current.quickSelfTrace;
  rerender({ org: B }); await flush();
  await act(async () => { await previous(); });
  expect(ipc.trace).not.toHaveBeenCalled();
});

it("keeps a new org write busy when an old write finishes / 旧写入完成时保持新组织写入的忙碌状态", async () => {
  const old = deferred<DebugConfigDto>(), current = deferred<DebugConfigDto>();
  ipc.trace.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const { result, rerender } = mount(); await flush();
  act(() => { void result.current.quickSelfTrace(); });
  rerender({ org: B }); await flush();
  act(() => { void result.current.quickSelfTrace(); });
  await flush(() => old.resolve(dto(expiry)));
  expect(result.current).toMatchObject({ tracingBusy: true, traceExpiry: null });
  expect(ipc.success).not.toHaveBeenCalled();
  await flush(() => current.resolve(dto(expiry)));
  expect(result.current).toMatchObject({ tracingBusy: false, traceExpiry: expiry });
  expect(ipc.trace).toHaveBeenLastCalledWith(30, B);
  expect(ipc.success).toHaveBeenCalledOnce();
});

it("starts one write for repeated synchronous clicks / 同步重复点击只发起一次写入", async () => {
  const pending = deferred<DebugConfigDto>(); ipc.trace.mockReturnValueOnce(pending.promise);
  const { result } = mount(); await flush();
  act(() => { void result.current.quickSelfTrace(); void result.current.quickSelfTrace(); });
  expect(ipc.trace).toHaveBeenCalledOnce();
  await flush(() => pending.resolve(dto(expiry)));
});

it("ignores the obsolete StrictMode setup read / 忽略 StrictMode 过期初始化读取", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result } = renderHook(() => useSelfTrace(A), { wrapper: StrictMode }); await flush();
  await flush(() => old.resolve(dto(expiry)));
  expect(result.current.traceExpiry).toBeNull();
});

it.each([
  ["en-US", "Tracing you for 30 min", "Trace failed: RAW_SF_{error}"],
  ["zh-CN", "已为您启用 30 分钟跟踪", "跟踪失败：RAW_SF_{error}"],
])("localizes current feedback and preserves raw errors: %s / 本地化当前反馈并保留原始错误", async (locale, success, failure) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
  const { result } = mount(); await flush();
  await act(async () => { await result.current.quickSelfTrace(); });
  expect(ipc.success).toHaveBeenCalledExactlyOnceWith(success);
  ipc.trace.mockRejectedValueOnce({ code: "SF_ERROR", message: "RAW_SF_{error}" });
  await act(async () => { await result.current.quickSelfTrace(); });
  expect(ipc.error).toHaveBeenCalledExactlyOnceWith(failure);
  expect(result.current).toMatchObject({ traceExpiry: expiry, tracingBusy: false });
});

it("refreshes the paused countdown on activation / 激活时刷新暂停的倒计时", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  ipc.get.mockResolvedValueOnce(dto("2030-01-01T00:30:00Z"));
  const { result, rerender } = renderHook(({ active }) => useSelfTrace(A, active), { initialProps: { active: false } });
  await flush(); expect(result.current.traceMinsLeft).toBe(30);
  vi.setSystemTime(new Date("2030-01-01T00:20:00Z"));
  expect(result.current.traceMinsLeft).toBe(30);
  rerender({ active: true }); expect(result.current.traceMinsLeft).toBe(10);
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(result.current.traceMinsLeft).toBe(9);
});
