// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { soqlColumnLabels } from "../../ipc/soql";
import { ResultTable } from "../ResultTable";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../ipc/soql", () => ({ soqlColumnLabels: vi.fn() }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const data = {
  columns: ["Name", "Contacts"], rows: [["Acme", "1"], ["Globex", "0"]], totalSize: 2,
  childTables: [{ rowIndex: 0, column: "Contacts", totalSize: 1, done: true,
    columns: ["LastName", "Age__c"], rows: [["Yin", 9]], children: [] }],
};

function setLocale(locale: string) {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { languages: [locale], language: locale, clipboard: { writeText } });
  return writeText;
}

describe("result details localization / 结果详情本地化", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it.each([
    ["en", 1, "Copy Name column", "Copied 1 Name value"],
    ["en", 2, "Copy Name column", "Copied 2 Name values"],
    ["zh-CN", 1, "复制 Name 列", "已复制 1 个 Name 值"],
    ["zh-CN", 2, "复制 Name 列", "已复制 2 个 Name 值"],
  ] as const)("localizes column copying / 本地化复制列: %s %s", async (locale, count, label, message) => {
    const writeText = setLocale(locale);
    render(<ResultTable data={{ ...data, rows: data.rows.slice(0, count), totalSize: count }} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(message));
    expect(writeText).toHaveBeenCalledWith(data.rows.slice(0, count).map((row) => row[0]).join("\n"));
  });

  it("localizes empty results and flattened column counts / 本地化空结果和平铺列数量", () => {
    setLocale("zh-CN");
    const { unmount } = render(<ResultTable data={{ columns: ["Name"], rows: [], totalSize: 0, childTables: [] }} />);
    expect(screen.getByText("无结果")).toBeTruthy();
    unmount();
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "平铺" }));
    const columns = screen.getByText("列");
    fireEvent.pointerDown(columns, { button: 0, ctrlKey: false });
    fireEvent.pointerUp(columns, { button: 0 });
    expect(screen.getByText("Contacts（2 列）")).toBeTruthy();
  });

  it("localizes a failed field-label lookup / 本地化字段标签查询失败", async () => {
    setLocale("zh-CN");
    vi.mocked(soqlColumnLabels).mockRejectedValueOnce(new Error("Synthetic failure / 合成失败"));
    render(<ResultTable data={data} query="SELECT Name FROM Account" />);
    fireEvent.click(screen.getByRole("button", { name: "显示字段标签" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("标签查询失败：Synthetic failure / 合成失败"));
  });
});
