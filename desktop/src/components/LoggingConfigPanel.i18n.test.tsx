// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoggingConfigPanel } from "./LoggingConfigPanel";

const mock = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../ipc/config", () => ({ loadLoggingConfig: mock.load, saveLoggingConfig: mock.save }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: mock.error } }));

beforeEach(() => {
  vi.resetAllMocks();
  mock.load.mockResolvedValue({ traceFlags: [], debugLevels: [], entities: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const language of ["en-US", "zh-CN"]) {
  const zh = language === "zh-CN";
  it(`localizes empty states and new rows / 本地化空状态及新增行: ${language}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    render(<LoggingConfigPanel org="synthetic@example.invalid" onClose={vi.fn()} />);
    expect(await screen.findByText(zh ? "暂无跟踪标志" : "No trace flags")).toBeTruthy();
    expect(screen.getByText(zh ? "暂无调试级别" : "No debug levels")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: zh ? "添加跟踪标志" : "Add trace flag" }));
    fireEvent.click(screen.getByRole("button", { name: zh ? "添加调试级别" : "Add debug level" }));
    expect(screen.getByRole("combobox", { name: zh ? "日志类型" : "Log type" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: zh ? "选择用户" : "Select user" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: zh ? "调试级别名称" : "Debug level name" })).toBeTruthy();
    expect(screen.getByRole("option", { name: zh ? "仅 Apex" : "Apex Only" })).toBeTruthy();
  });

  it(`preserves unknown log types / 保留未知日志类型: ${language}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    mock.load.mockResolvedValueOnce({
      entities: [], debugLevels: [], traceFlags: [{
        id: "synthetic", logType: "toString", tracedEntityId: "synthetic-user",
        tracedEntityName: "Synthetic user / 合成用户", tracedEntityKind: "User", debugLevelId: "",
        startDate: null, expirationDate: null, creatorName: "",
      }],
    });
    render(<LoggingConfigPanel org="synthetic@example.invalid" onClose={vi.fn()} />);
    expect(await screen.findByText("toString", { exact: true })).toBeTruthy();
  });
}
