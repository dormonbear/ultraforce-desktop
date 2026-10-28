// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LogRefDto, LogViewDto } from "../types";
import { useLogView } from "./useLogView";

const ipc = vi.hoisted(() => ({ fetch: vi.fn(), cached: vi.fn(), parse: vi.fn(), lines: vi.fn() }));
vi.mock("./logCache", () => ({ fetchLogView: ipc.fetch, listCachedIds: ipc.cached }));
vi.mock("../ipc/logs", () => ({ parseLogView: ipc.parse, sourceLineIndices: ipc.lines }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const dto = (raw: string): LogViewDto => ({ raw, apiVersion: "60.0", units: [] });
const log: LogRefDto = { id: "synthetic-log", operation: "SyntheticOperation", status: "Success", startTime: "2026-10-28T00:00:00Z", application: "SyntheticApp", user: "SyntheticUser", durationMs: 1, logLength: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  ipc.cached.mockResolvedValue(new Set());
  ipc.lines.mockResolvedValue([]);
});
afterEach(cleanup);

it("keeps the latest selected log after an older body arrives / 旧正文迟到后保留最新选中日志", async () => {
  const old = deferred<LogViewDto>();
  ipc.fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(dto("CURRENT_LOG"));
  const { result } = renderHook(() => useLogView("synthetic-org"));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.select("old-log"); });
  await act(async () => { await result.current.select("current-log"); });
  expect(result.current.view?.raw).toBe("CURRENT_LOG");
  await act(async () => { old.resolve(dto("OLD_LOG")); await pending; });
  expect(result.current.selectedId).toBe("current-log");
  expect(result.current.view?.raw).toBe("CURRENT_LOG");
  await act(async () => { await result.current.select("old-log"); });
  expect(result.current.view?.raw).toBe("OLD_LOG");
  expect(ipc.fetch).toHaveBeenCalledTimes(2);
});

it("does not show an old request's failure on the current log / 不在当前日志显示旧请求失败", async () => {
  const old = deferred<LogViewDto>();
  ipc.fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(dto("CURRENT_LOG"));
  const { result } = renderHook(() => useLogView("synthetic-org"));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.select("old-log"); });
  await act(async () => { await result.current.select("current-log"); });
  await act(async () => { old.reject(new Error("OLD_FAILURE / 旧失败")); await pending; });
  expect(result.current.viewError).toBeNull();
  expect(result.current.view?.raw).toBe("CURRENT_LOG");
});

it("keeps source line mappings owned by the current log / 让源码行映射归属于当前日志", async () => {
  const oldLines = deferred<number[]>();
  ipc.fetch.mockResolvedValueOnce(dto("OLD_LOG")).mockResolvedValueOnce(dto("CURRENT_LOG"));
  ipc.lines.mockReturnValueOnce(oldLines.promise).mockResolvedValueOnce([2]);
  const { result } = renderHook(() => useLogView("synthetic-org"));
  await act(async () => { await result.current.select("old-log"); });
  await act(async () => { await result.current.select("current-log"); });
  expect([...result.current.sourceLines]).toEqual([2]);
  await act(async () => { oldLines.resolve([0]); });
  expect([...result.current.sourceLines]).toEqual([2]);
});

it("does not finish the current loading state for an older request / 不因旧请求完成而结束当前加载状态", async () => {
  const old = deferred<LogViewDto>(), current = deferred<LogViewDto>();
  ipc.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const { result } = renderHook(() => useLogView("synthetic-org"));
  let pendingOld!: Promise<void>, pendingCurrent!: Promise<void>;
  await act(async () => { pendingOld = result.current.select("old-log"); });
  await act(async () => { pendingCurrent = result.current.select("current-log"); });
  await act(async () => { old.resolve(dto("OLD_LOG")); await pendingOld; });
  expect(result.current.viewLoading).toBe(true);
  await act(async () => { current.resolve(dto("CURRENT_LOG")); await pendingCurrent; });
  expect(result.current.viewLoading).toBe(false);
});

it("keeps an organization reset clear after a pending response / 待完成响应返回后仍保持组织重置状态", async () => {
  const old = deferred<LogViewDto>();
  ipc.fetch.mockReturnValue(old.promise);
  const { result } = renderHook(() => useLogView("synthetic-org"));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.select("old-log"); });
  act(() => result.current.resetForOrg());
  await act(async () => { old.resolve(dto("OLD_LOG")); await pending; });
  expect(result.current.selectedId).toBeNull();
  expect(result.current.view).toBeNull();
  expect(result.current.viewLoading).toBe(false);
});

it("keeps the latest local log when parsing completes out of order / 解析乱序完成时保留最新本地日志", async () => {
  const old = deferred<LogViewDto>();
  ipc.parse.mockReturnValueOnce(old.promise).mockResolvedValueOnce(dto("CURRENT_LOCAL"));
  const { result } = renderHook(() => useLogView("synthetic-org"));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.showLocalLog("OLD_LOCAL"); });
  await act(async () => { await result.current.showLocalLog("CURRENT_LOCAL"); });
  await act(async () => { old.resolve(dto("OLD_LOCAL")); await pending; });
  expect(result.current.view?.raw).toBe("CURRENT_LOCAL");
  expect(result.current.orgless).toBe(true);
});

it("does not clear current mappings after an old mapping failure / 旧映射失败后不清空当前映射", async () => {
  const oldLines = deferred<number[]>();
  ipc.fetch.mockResolvedValueOnce(dto("OLD_LOG")).mockResolvedValueOnce(dto("CURRENT_LOG"));
  ipc.lines.mockReturnValueOnce(oldLines.promise).mockResolvedValueOnce([2]);
  const { result } = renderHook(() => useLogView("synthetic-org"));
  await act(async () => { await result.current.select("old-log"); });
  await act(async () => { await result.current.select("current-log"); });
  await act(async () => { oldLines.reject(new Error("OLD_MAPPING_FAILURE / 旧映射失败")); });
  expect([...result.current.sourceLines]).toEqual([2]);
});

it("clears old mappings while a cached selection resolves its own / 缓存选择解析自身映射时清除旧映射", async () => {
  const pendingLines = deferred<number[]>();
  ipc.fetch.mockResolvedValueOnce(dto("FIRST_LOG")).mockResolvedValueOnce(dto("SECOND_LOG"));
  ipc.lines.mockResolvedValueOnce([0]).mockResolvedValueOnce([2]).mockReturnValueOnce(pendingLines.promise);
  const { result } = renderHook(() => useLogView("synthetic-org"));
  await act(async () => { await result.current.select("first-log"); });
  await act(async () => { await result.current.select("second-log"); });
  await act(async () => { await result.current.select("first-log"); });
  expect(result.current.view?.raw).toBe("FIRST_LOG");
  expect([...result.current.sourceLines]).toEqual([]);
  await act(async () => { pendingLines.resolve([0]); });
  expect([...result.current.sourceLines]).toEqual([0]);
});

it("reuses completed parsed log cache / 复用已完成的日志解析缓存", async () => {
  ipc.fetch.mockResolvedValueOnce(dto("FIRST_LOG")).mockResolvedValueOnce(dto("SECOND_LOG"));
  const { result } = renderHook(() => useLogView("synthetic-org"));
  await act(async () => { await result.current.select("first-log"); });
  await act(async () => { await result.current.select("second-log"); });
  await act(async () => { await result.current.select("first-log"); });
  expect(result.current.view?.raw).toBe("FIRST_LOG");
  expect(ipc.fetch).toHaveBeenCalledTimes(2);
});

it("keeps local logs orgless and skips source mapping / 本地日志保持无组织且跳过源码映射", async () => {
  ipc.parse.mockResolvedValue(dto("LOCAL_LOG"));
  const { result } = renderHook(() => useLogView("synthetic-org"));
  await act(async () => { await result.current.showLocalLog("LOCAL_LOG"); });
  expect(result.current.view?.raw).toBe("LOCAL_LOG");
  expect(result.current.orgless).toBe(true);
  expect(result.current.viewLoading).toBe(false);
  expect(ipc.lines).not.toHaveBeenCalled();
  expect(ipc.fetch).not.toHaveBeenCalled();
});

it.each(["reset", "refresh"] as const)("does not refill the cache after %s / 重置或刷新后不重新填充旧缓存", async (boundary) => {
  const old = deferred<LogViewDto>();
  ipc.fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(dto("CURRENT_LOG"));
  const { result } = renderHook(() => useLogView("synthetic-org"));
  let pending!: Promise<string>;
  await act(async () => { pending = result.current.getBody(log); });
  act(() => boundary === "reset" ? result.current.resetForOrg() : result.current.clearViewCache());
  await act(async () => { await result.current.select(log.id); });
  await act(async () => { old.resolve(dto("OLD_LOG")); expect(await pending).toBe("OLD_LOG"); });
  await act(async () => { await result.current.select(log.id); });
  expect(result.current.view?.raw).toBe("CURRENT_LOG");
  expect(ipc.fetch).toHaveBeenCalledTimes(2);
});

it.each(["select", "local", "reset"] as const)("clears the old source target on %s / 切换日志或重置时清除旧源码目标", async (boundary) => {
  ipc.fetch.mockResolvedValue(dto("CURRENT_LOG"));
  ipc.parse.mockResolvedValue(dto("LOCAL_LOG"));
  const { result } = renderHook(() => useLogView("synthetic-org"));
  act(() => result.current.setSourceRef({ className: "SyntheticClass", line: 1 }));
  await act(async () => {
    if (boundary === "select") await result.current.select(log.id);
    else if (boundary === "local") await result.current.showLocalLog("LOCAL_LOG");
    else result.current.resetForOrg();
  });
  expect(result.current.sourceRef).toBeNull();
});

it.each(["select", "local"] as const)("finishes loading after the current %s request fails / 当前日志请求失败后结束加载", async (boundary) => {
  const failure = new Error("CURRENT_FAILURE / 当前失败");
  ipc.fetch.mockRejectedValue(failure);
  ipc.parse.mockRejectedValue(failure);
  const { result } = renderHook(() => useLogView("synthetic-org"));
  await act(async () => {
    if (boundary === "select") await result.current.select(log.id);
    else await result.current.showLocalLog("LOCAL_LOG");
  });
  expect(result.current.viewLoading).toBe(false);
  expect(result.current.viewError).toBe(failure.message);
});
