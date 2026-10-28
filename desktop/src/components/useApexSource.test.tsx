// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearApexSourceCache, useApexSource, type ApexSource } from "./useApexSource";

const ipc = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../ipc/apex", () => ({ fetchApexSource: ipc.fetch }));
const source = (body: string): ApexSource => ({ name: "SyntheticClass", kind: "ApexClass", body });
function deferred() {
  let resolve!: (value: ApexSource) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ApexSource>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { clearApexSourceCache(); ipc.fetch.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([false, true])("does not let a closed view replace current source (cache cleared: %s) / 不让已关闭视图覆盖当前源码（缓存已清空：%s）", async (clearCache) => {
  const old = deferred(), current = deferred();
  ipc.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const previous = renderHook(() => useApexSource("SyntheticClass", "synthetic-org"));
  previous.unmount();
  if (clearCache) clearApexSourceCache();
  const active = renderHook(() => useApexSource("SyntheticClass", "synthetic-org"));
  await act(async () => current.resolve(source("CURRENT_BODY")));
  expect(active.result.current.src?.body).toBe("CURRENT_BODY");
  await act(async () => old.resolve(source("OLD_BODY")));
  expect(active.result.current.src?.body).toBe("CURRENT_BODY");
  const reopened = renderHook(() => useApexSource("SyntheticClass", "synthetic-org"));
  expect(reopened.result.current.src?.body).toBe("CURRENT_BODY");
  expect(ipc.fetch).toHaveBeenCalledTimes(2);
});

it("keeps a late closed-log failure out of the active view / 不让已关闭日志的迟到失败进入当前视图", async () => {
  const old = deferred();
  ipc.fetch.mockReturnValueOnce(old.promise).mockResolvedValue(source("CURRENT_BODY"));
  const previous = renderHook(() => useApexSource("SyntheticClass", "synthetic-org"));
  previous.unmount(); clearApexSourceCache();
  const active = renderHook(() => useApexSource("SyntheticClass", "synthetic-org"));
  await act(async () => {});
  await act(async () => old.reject(new Error("OLD_FAILURE / 旧失败")));
  expect(active.result.current.src?.body).toBe("CURRENT_BODY");
  expect(active.result.current.error).toBeNull();
});

it("rejects old cache writes without stranding a mounted view / 拒绝旧缓存写入且不使已挂载视图停滞", async () => {
  const old = deferred();
  ipc.fetch.mockReturnValueOnce(old.promise).mockResolvedValue(source("CURRENT_BODY"));
  const previous = renderHook(() => useApexSource("SyntheticClass", "synthetic-org"));
  clearApexSourceCache();
  const active = renderHook(() => useApexSource("SyntheticClass", "synthetic-org"));
  await act(async () => {});
  await act(async () => old.resolve(source("OLD_BODY")));
  const reopened = renderHook(() => useApexSource("SyntheticClass", "synthetic-org"));
  expect(active.result.current.src?.body).toBe("CURRENT_BODY");
  expect(reopened.result.current.src?.body).toBe("CURRENT_BODY");
  expect(previous.result.current.src?.body).toBe("OLD_BODY");
  expect(ipc.fetch).toHaveBeenCalledTimes(2);
});

it("reuses completed current source without crossing org keys / 复用已完成的当前源码且不跨组织键", async () => {
  ipc.fetch.mockResolvedValueOnce(source("ORG_A_BODY")).mockResolvedValueOnce(source("ORG_B_BODY"));
  const current = renderHook(() => useApexSource("SyntheticClass", "org-a"));
  await act(async () => {});
  expect(current.result.current.src?.body).toBe("ORG_A_BODY");
  const sameOrg = renderHook(() => useApexSource("SyntheticClass", "org-a"));
  expect(sameOrg.result.current.src?.body).toBe("ORG_A_BODY");
  const otherOrg = renderHook(() => useApexSource("SyntheticClass", "org-b"));
  await act(async () => {});
  expect(otherOrg.result.current.src?.body).toBe("ORG_B_BODY");
  expect(ipc.fetch.mock.calls).toEqual([["SyntheticClass", "org-a"], ["SyntheticClass", "org-b"]]);
});
