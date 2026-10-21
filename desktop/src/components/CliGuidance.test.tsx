// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CliGuidance } from "./CliGuidance";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const missing = { state: "not_found", version: null, minVersion: "2.0.0", foundAt: null } as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

it("updates mounted guidance without losing retry behavior / 更新已挂载指引并保留重试行为", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const retry = vi.fn();
  render(<CliGuidance status={missing} onRetry={retry} />);
  expect(screen.getByRole("heading", { name: "Salesforce CLI not found" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByRole("heading", { name: "未找到 Salesforce CLI" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(retry).toHaveBeenCalledOnce();
});

it.each([
  ["en-US", "Copy command", "Copy failed"],
  ["zh-CN", "复制命令", "复制失败"],
])("reports clipboard denial in the active locale / 按当前语言报告剪贴板拒绝: %s", async (language, label, failure) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
  const writeText = vi.fn().mockRejectedValue(new Error("synthetic clipboard denial"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<CliGuidance status={missing} onRetry={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(failure));
  expect(writeText).toHaveBeenCalledWith("npm install -g @salesforce/cli");
  expect(toast.success).not.toHaveBeenCalled();
});
