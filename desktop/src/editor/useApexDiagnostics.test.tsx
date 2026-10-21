// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoqlDiagnosticDto } from "../types";
import { useApexDiagnostics } from "./useApexDiagnostics";

const ipc = vi.hoisted(() => ({ soql: vi.fn(), ast: vi.fn() }));
vi.mock("../ipc/apex", () => ({ apexSoqlDiagnostics: ipc.soql, apexDiagnostics: ipc.ast }));

const original = { src: "System.debug('synthetic');", org: "dev@example.invalid", mounted: true };
function diagnostics(message: string): SoqlDiagnosticDto[] {
  return [{ start: 0, end: 3, message, severity: "error" }];
}
function deferred() {
  let resolve!: (value: SoqlDiagnosticDto[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SoqlDiagnosticDto[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const markers = new Map<string, editor.IMarkerData[]>();
  const disposed = vi.fn(() => false);
  const model = {
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }), isDisposed: disposed,
  } as unknown as editor.ITextModel;
  const getModel = vi.fn<() => editor.ITextModel | null>(() => model);
  const setModelMarkers = vi.fn((_model: editor.ITextModel, owner: string, values: editor.IMarkerData[]) => {
    markers.set(owner, values);
  });
  const editorRef = { current: { getModel } as unknown as editor.IStandaloneCodeEditor | null };
  const monacoRef = { current: {
    editor: { setModelMarkers }, MarkerSeverity: { Error: 8, Warning: 4 },
  } as unknown as Monaco | null };
  return { editorRef, monacoRef, markers, setModelMarkers, getModel, model, disposed };
}
async function tick() {
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
}
beforeEach(() => {
  vi.useFakeTimers();
  ipc.soql.mockReset().mockResolvedValue(diagnostics("Current SOQL / 当前 SOQL"));
  ipc.ast.mockReset().mockResolvedValue(diagnostics("Current AST / 当前 AST"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("debounces and publishes both independent marker owners / 防抖并发布两个独立来源的标记", async () => {
  const f = fixture();
  renderHook(() => useApexDiagnostics({ ...original, ...f }));
  await act(async () => { await vi.advanceTimersByTimeAsync(349); });
  expect(ipc.soql).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(ipc.soql).toHaveBeenCalledExactlyOnceWith(original.src, original.org);
  expect(ipc.ast).toHaveBeenCalledExactlyOnceWith(original.src, original.org);
  expect(f.markers.get("apex-soql")?.[0]).toMatchObject({ message: "Current SOQL / 当前 SOQL", severity: 8, startColumn: 1, endColumn: 4 });
  expect(f.markers.get("apex-ast")?.[0].message).toBe("Current AST / 当前 AST");
});

it("replaces a pending debounce after an org change / 组织变化后替换等待中的防抖任务", async () => {
  const f = fixture();
  const { rerender } = renderHook((p) => useApexDiagnostics({ ...p, ...f }), { initialProps: original });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  rerender({ ...original, org: "stg@example.invalid" });
  await tick();
  expect(ipc.soql).toHaveBeenCalledExactlyOnceWith(original.src, "stg@example.invalid");
  expect(ipc.ast).toHaveBeenCalledExactlyOnceWith(original.src, "stg@example.invalid");
});

describe.each(["soql", "ast"] as const)("pending phase / 等待阶段: %s", (phase) => {
  it.each(["organization", "source", "unmount"] as const)("ignores obsolete results after %s / 变化或卸载后忽略过期结果", async (change) => {
    const f = fixture();
    const old = deferred();
    ipc[phase].mockImplementationOnce(() => old.promise);
    const { rerender, unmount } = renderHook((p) => useApexDiagnostics({ ...p, ...f }), { initialProps: original });
    await tick();
    if (change === "unmount") unmount();
    else {
      rerender({ ...original, ...(change === "organization" ? { org: "stg@example.invalid" } : { src: "System.debug('new');" }) });
      await tick();
    }
    const before = [...f.setModelMarkers.mock.calls];
    await act(async () => { old.resolve(diagnostics("Obsolete / 已过期")); });
    expect(f.setModelMarkers.mock.calls).toEqual(before);
    if (phase === "soql") {
      expect(ipc.ast.mock.calls.filter(([src, org]) => src === original.src && org === original.org)).toHaveLength(0);
    }
  });
});

it("does not start AST diagnostics after an obsolete SOQL rejection / 过期 SOQL 请求失败后不启动 AST 诊断", async () => {
  const f = fixture();
  const old = deferred();
  ipc.soql.mockImplementationOnce(() => old.promise);
  const { rerender } = renderHook((p) => useApexDiagnostics({ ...p, ...f }), { initialProps: original });
  await tick();
  rerender({ ...original, org: "stg@example.invalid" });
  await tick();
  await act(async () => { old.reject(new Error("Synthetic / 合成")); });
  expect(ipc.ast).toHaveBeenCalledExactlyOnceWith(original.src, "stg@example.invalid");
});

it("clears obsolete markers immediately when the org changes / 组织变化时立即清除过期标记", async () => {
  const f = fixture();
  const { rerender } = renderHook((p) => useApexDiagnostics({ ...p, ...f }), { initialProps: original });
  await tick();
  expect(f.markers.get("apex-soql")).toHaveLength(1);
  rerender({ ...original, org: "stg@example.invalid" });
  expect(f.markers.get("apex-soql")).toEqual([]);
  expect(f.markers.get("apex-ast")).toEqual([]);
});

it("clears the debounce timer on unmount / 卸载时清理防抖计时器", async () => {
  const f = fixture();
  const { unmount } = renderHook(() => useApexDiagnostics({ ...original, ...f }));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  await tick();
  expect(ipc.soql).not.toHaveBeenCalled();
  expect(ipc.ast).not.toHaveBeenCalled();
});

it.each(["disposed", "replaced", "detached", "monaco"] as const)("ignores unavailable or replaced editors / 忽略不可用或已替换的编辑器: %s", async (state) => {
  const f = fixture();
  const old = deferred();
  ipc.soql.mockImplementationOnce(() => old.promise);
  renderHook(() => useApexDiagnostics({ ...original, ...f }));
  await tick();
  if (state === "disposed") f.disposed.mockReturnValue(true);
  else if (state === "replaced") f.getModel.mockReturnValue(null);
  else if (state === "detached") f.editorRef.current = null;
  else f.monacoRef.current = null;
  const before = [...f.setModelMarkers.mock.calls];
  await act(async () => { old.resolve(diagnostics("Obsolete / 已过期")); });
  expect(f.setModelMarkers.mock.calls).toEqual(before);
  expect(ipc.ast).not.toHaveBeenCalled();
});

it("keeps AST diagnostics independent of a current SOQL failure / 当前 SOQL 失败不影响 AST 诊断", async () => {
  ipc.soql.mockRejectedValue(new Error("Synthetic / 合成"));
  const f = fixture();
  renderHook(() => useApexDiagnostics({ ...original, ...f }));
  await tick();
  expect(ipc.ast).toHaveBeenCalledExactlyOnceWith(original.src, original.org);
  expect(f.markers.get("apex-ast")?.[0].message).toBe("Current AST / 当前 AST");
});

it("keeps SOQL markers when current AST diagnostics fail / 当前 AST 诊断失败时保留 SOQL 标记", async () => {
  ipc.ast.mockRejectedValue(new Error("Synthetic / 合成"));
  const f = fixture();
  renderHook(() => useApexDiagnostics({ ...original, ...f }));
  await tick();
  expect(f.markers.get("apex-soql")?.[0].message).toBe("Current SOQL / 当前 SOQL");
});

it("waits for mounted editor and Monaco refs / 等待编辑器挂载及 Monaco 引用就绪", async () => {
  renderHook(() => useApexDiagnostics({ ...original, editorRef: { current: null }, monacoRef: { current: null } }));
  const f = fixture();
  renderHook(() => useApexDiagnostics({ ...original, ...f, mounted: false }));
  await tick();
  expect(ipc.soql).not.toHaveBeenCalled();
  expect(ipc.ast).not.toHaveBeenCalled();
});
