// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { presetLevels } from "./debug-presets";
import type { CategoryLevels, DebugConfigDto } from "./types";
import { useDebugConfig } from "./useDebugConfig";

const ipc = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), toast: vi.fn() }));
vi.mock("./ipc/config", () => ({ getDebugConfig: ipc.get, setDebugConfig: ipc.set }));
vi.mock("sonner", () => ({ toast: { error: ipc.toast } }));
const A = "a@example.invalid", B = "b@example.invalid";
const first = presetLevels("Apex Only"), second = presetLevels("Full Debugging");
const dto = (levels: CategoryLevels): DebugConfigDto => ({ levels, traceFlagId: "synthetic", expirationDate: null });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush(action?: () => void) { await act(async () => { action?.(); }); }
function mount(requestedOrg: string | null = A) {
  const initialProps: { org: string | null } = { org: requestedOrg };
  return renderHook(({ org }) => useDebugConfig(org), { initialProps });
}
beforeEach(() => {
  vi.resetAllMocks();
  ipc.get.mockResolvedValue(dto(first));
  ipc.set.mockImplementation((levels: CategoryLevels) => Promise.resolve(dto(levels)));
});
afterEach(cleanup);

it("loads the explicitly selected org / 加载显式选择的组织", async () => {
  const { result } = mount(); await flush();
  expect(ipc.get).toHaveBeenCalledExactlyOnceWith(A);
  expect(result.current.levels).toEqual(first);
});

it("clears previous levels while a new org loads / 新组织加载时清除前一组织级别", async () => {
  const current = deferred<DebugConfigDto>();
  const { result, rerender } = mount(); await flush();
  ipc.get.mockReturnValueOnce(current.promise); rerender({ org: B });
  expect(result.current).toMatchObject({ levels: null, error: null, applying: false });
  await flush(() => current.resolve(dto(second)));
  expect(result.current.levels).toEqual(second);
});

it("ignores an old org read after the new org succeeds / 新组织成功后忽略旧组织读取", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount(); rerender({ org: B }); await flush();
  await flush(() => old.resolve(dto(second)));
  expect(result.current.levels).toEqual(first);
  expect(result.current.error).toBeNull();
});

it("ignores an old org read failure / 忽略旧组织读取失败", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount(); rerender({ org: B }); await flush();
  await flush(() => old.reject(new Error("Old org / 旧组织")));
  expect(result.current.error).toBeNull();
  expect(result.current.levels).toEqual(first);
});

it("rejects an earlier read after returning to the same org / 返回相同组织后拒绝更早的读取", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount();
  rerender({ org: B }); await flush(); rerender({ org: A }); await flush();
  await flush(() => old.resolve(dto(second)));
  expect(result.current.levels).toEqual(first);
});

it("ignores an old org write completion / 忽略旧组织写入完成", async () => {
  const old = deferred<DebugConfigDto>(); ipc.set.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount(); await flush();
  act(() => { result.current.apply(second); });
  expect(ipc.set).toHaveBeenCalledExactlyOnceWith(second, A);
  rerender({ org: B }); await flush();
  await flush(() => old.resolve(dto(second)));
  expect(result.current).toMatchObject({ levels: first, applying: false, error: null });
});

it("does not surface a previous org write failure / 不显示前一组织写入失败", async () => {
  const old = deferred<DebugConfigDto>(); ipc.set.mockReturnValueOnce(old.promise);
  const { result, rerender } = mount(); await flush();
  act(() => { result.current.apply(second); }); rerender({ org: B }); await flush();
  await flush(() => old.reject(new Error("Old write / 旧写入")));
  expect(result.current).toMatchObject({ levels: first, applying: false, error: null });
  expect(ipc.toast).not.toHaveBeenCalled();
});

it("drops pending write feedback after unmount / 卸载后丢弃等待中的写入反馈", async () => {
  const old = deferred<DebugConfigDto>(); ipc.set.mockReturnValueOnce(old.promise);
  const { result, unmount } = mount(); await flush();
  act(() => { result.current.apply(second); }); unmount();
  await flush(() => old.reject(new Error("Unmounted / 已卸载")));
  expect(ipc.toast).not.toHaveBeenCalled();
});

it("preserves a current read failure and clears it on org change / 保留当前读取失败并在组织变化时清除", async () => {
  ipc.get.mockRejectedValueOnce(new Error("Current / 当前"));
  const { result, rerender } = mount(); await flush();
  expect(result.current.error).toBe("Current / 当前");
  rerender({ org: B }); await flush();
  expect(result.current.error).toBeNull();
});

it("applies current levels to the current org / 将当前级别应用到当前组织", async () => {
  const { result } = mount(B); await flush();
  await flush(() => result.current.apply(second));
  expect(ipc.set).toHaveBeenCalledExactlyOnceWith(second, B);
  expect(result.current).toMatchObject({ levels: second, applying: false, error: null });
});

it("preserves current write failure feedback / 保留当前写入失败反馈", async () => {
  ipc.set.mockRejectedValueOnce(new Error("Current write / 当前写入"));
  const { result } = mount(); await flush();
  await flush(() => result.current.apply(second));
  expect(result.current).toMatchObject({ applying: false, error: "Current write / 当前写入" });
  expect(ipc.toast).toHaveBeenCalledExactlyOnceWith("Debug config: Current write / 当前写入");
});

it("keeps newer optimistic values and pending state / 保留更新的乐观值及等待状态", async () => {
  const old = deferred<DebugConfigDto>(), current = deferred<DebugConfigDto>();
  ipc.set.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const { result } = mount(); await flush();
  act(() => { result.current.apply(first); }); act(() => { result.current.apply(second); });
  await flush(() => old.resolve(dto(first)));
  expect(result.current).toMatchObject({ levels: second, applying: true });
  await flush(() => current.resolve(dto(second)));
  expect(result.current).toMatchObject({ levels: second, applying: false });
});

it("does not replace an applied value with an older initial read / 不用旧的初始读取替换已应用的值", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result } = mount(); await flush(() => result.current.apply(second));
  await flush(() => old.resolve(dto(first)));
  expect(result.current.levels).toEqual(second);
});

it("ignores StrictMode's obsolete first read / 忽略 StrictMode 过期的首次读取", async () => {
  const old = deferred<DebugConfigDto>(); ipc.get.mockReturnValueOnce(old.promise);
  const { result } = renderHook(() => useDebugConfig(A), { wrapper: StrictMode }); await flush();
  expect(ipc.get).toHaveBeenCalledTimes(2);
  await flush(() => old.resolve(dto(second)));
  expect(result.current.levels).toEqual(first);
});
