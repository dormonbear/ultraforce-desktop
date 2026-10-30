// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SfErrorDetail } from "./SfErrorDetail";
import LocalEditor from "../editor/LocalEditor";

vi.mock("../editor/monaco-local", () => ({ initializeLocalMonaco: () => new Promise(() => {}) }));
vi.mock("@monaco-editor/react", () => ({ default: () => <div /> }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const detail = "RAW_DETAIL {line} $&";
const raw = `Salesforce error (status 1): MALFORMED_QUERY: ${detail}`;

for (const language of ["en-US", "zh-CN"] as const) {
  const zh = language === "zh-CN";
  it(`localizes the raw error label without changing error data / 本地化原始错误标签并保留错误数据: ${language}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    render(<SfErrorDetail error={raw} />);
    expect(screen.getByText("Malformed query")).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    const summary = screen.getByText(zh ? "原始错误" : "Raw error");
    fireEvent.click(summary);
    expect(summary.closest("details")?.open).toBe(true);
    expect(screen.getByText(raw)).toBeTruthy();
  });

  it(`localizes the generic error heading / 本地化通用错误标题: ${language}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    render(<SfErrorDetail error={detail} />);
    expect(screen.getByText(zh ? "错误" : "Error")).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
  });

  it(`localizes the editor loading state / 本地化编辑器加载状态: ${language}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    render(<LocalEditor />);
    expect(screen.getByRole("status").textContent).toBe(zh ? "正在加载编辑器…" : "Loading editor…");
  });
}

it("updates labels without closing raw details or changing the error / 切换语言时保留展开状态及原始错误", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<><SfErrorDetail error={raw} /><LocalEditor /></>);
  const details = screen.getByText("Raw error").closest("details")!;
  fireEvent.click(screen.getByText("Raw error"));
  expect(details.open).toBe(true);
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByText("原始错误").closest("details")).toBe(details);
  expect(details.open).toBe(true);
  expect(screen.getByText(raw)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("正在加载编辑器…");
});
