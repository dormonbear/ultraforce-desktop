// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLoggingConfig } from "./useLoggingConfig";

const mock = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("./ipc/config", () => ({ loadLoggingConfig: mock.load, saveLoggingConfig: mock.save }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: mock.error } }));

beforeEach(() => {
  vi.resetAllMocks();
  mock.load.mockResolvedValue({ traceFlags: [], debugLevels: [], entities: [] });
  mock.save.mockResolvedValue({ results: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function config(language: string) {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
  const hook = renderHook(() => useLoggingConfig("synthetic@example.invalid"));
  await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...hook, languages };
}

for (const language of ["en-US", "zh-CN"]) {
  const zh = language === "zh-CN";
  it(`localizes save success / 本地化保存成功: ${language}`, async () => {
    const { result } = await config(language);
    let saved = false;
    await act(async () => { saved = await result.current.save(); });
    expect(saved).toBe(true);
    expect(mock.success).toHaveBeenCalledExactlyOnceWith(zh ? "日志配置已保存" : "Logging configuration saved");
  });

  it(`localizes partial failures / 本地化部分失败: ${language}`, async () => {
    mock.save.mockResolvedValue({ results: [{ ok: false, sobject: "TraceFlag", op: "create", error: "RAW {count}" }] });
    const { result } = await config(language);
    let saved = true;
    await act(async () => { saved = await result.current.save(); });
    expect(saved).toBe(false);
    expect(mock.error).toHaveBeenCalledExactlyOnceWith(zh ? "日志配置：1 项失败" : "Logging config: 1 failed");
    expect(result.current.error).toBe("TraceFlag create: RAW {count}");
  });

  it(`preserves backend errors / 保留后端错误: ${language}`, async () => {
    mock.save.mockRejectedValue("RAW {count} / 原始错误");
    const { result } = await config(language);
    await act(async () => { await result.current.save(); });
    expect(mock.error).toHaveBeenCalledExactlyOnceWith(
      zh ? "日志配置：RAW {count} / 原始错误" : "Logging config: RAW {count} / 原始错误",
    );
    expect(result.current.error).toBe("RAW {count} / 原始错误");
  });
}

it("retains partial and reload errors / 同时保留部分失败及重新加载错误", async () => {
  mock.load.mockResolvedValueOnce({ traceFlags: [], debugLevels: [], entities: [] });
  mock.load.mockRejectedValueOnce("RELOAD_ERROR / 重新加载错误");
  mock.save.mockResolvedValue({ results: [{ ok: false, sobject: "TraceFlag", op: "create", error: "PARTIAL_ERROR / 部分错误" }] });
  const { result } = await config("en-US");
  await act(async () => { await result.current.save(); });
  expect(result.current.error).toContain("PARTIAL_ERROR / 部分错误");
  expect(result.current.error).toContain("RELOAD_ERROR / 重新加载错误");
});

it("uses the current language when a pending save finishes / 等待保存完成时使用当前语言", async () => {
  const { result, languages } = await config("en-US");
  let finish!: (value: { results: never[] }) => void;
  mock.save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<boolean>;
  act(() => { pending = result.current.save(); });
  languages.mockReturnValue(["zh-CN"]);
  await act(async () => { finish({ results: [] }); await pending; });
  expect(mock.success).toHaveBeenCalledExactlyOnceWith("日志配置已保存");
});
