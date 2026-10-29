// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Explorer } from "./Explorer";
import type { TreeNode } from "../fs/tree";

const fixture: TreeNode[] = [
  { path: "/ws/queries", name: "queries", kind: "dir", children: [
    { path: "/ws/queries/deep.soql", name: "deep.soql", kind: "file" },
  ] },
  { path: "/ws/a.soql", name: "a.soql", kind: "file" },
];

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(), readTextFile: vi.fn(), writeTextFile: vi.fn(), mkdir: vi.fn(), rename: vi.fn(), remove: vi.fn(),
}));
vi.mock("../fs/tree", () => ({
  readTree: vi.fn(async () => fixture), createFile: vi.fn(), createDir: vi.fn(),
  renameNode: vi.fn(async (path: string) => path), removeNode: vi.fn(), moveNode: vi.fn(),
}));

function language(initial: string) {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue([initial]);
  return (next: string) => {
    languages.mockReturnValue([next]);
    act(() => window.dispatchEvent(new Event("languagechange")));
  };
}

function showExplorer() {
  render(<Explorer root="/ws" ext="soql" activePath={null} onOpen={() => {}} onRenamed={() => {}} onRemoved={() => {}} />);
}

describe("explorer localization / 文件浏览器本地化", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("keeps English controls and menus / 保留英文控件及菜单", async () => {
    language("en-US");
    showExplorer();
    await screen.findByText("queries");
    expect(screen.getByPlaceholderText("Filter by name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle search mode" })).toBeTruthy();
    fireEvent.contextMenu(screen.getByText("queries"));
    expect(await screen.findByRole("menuitem", { name: "New File" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
  });

  it("localizes Chinese controls and menus / 本地化中文控件及菜单", async () => {
    language("zh-CN");
    showExplorer();
    expect(await screen.findByText("a.soql")).toBeTruthy();
    expect(screen.getByPlaceholderText("按名称筛选")).toBeTruthy();
    expect(screen.getByRole("tree", { name: "文件" })).toBeTruthy();
    for (const name of ["切换搜索模式", "区分大小写", "使用正则表达式", "新建文件", "新建文件夹", "刷新"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.contextMenu(screen.getByText("queries"));
    expect(await screen.findByRole("menuitem", { name: "新建文件" })).toBeTruthy();
    for (const name of ["新建文件夹", "重命名", "删除"]) expect(screen.getByRole("menuitem", { name })).toBeTruthy();
  });

  it("preserves search text and options on language change / 切换语言时保留搜索文本与选项", async () => {
    const changeLanguage = language("en-US");
    showExplorer();
    await screen.findByText("a.soql");
    fireEvent.click(screen.getByRole("button", { name: "Match case" }));
    fireEvent.click(screen.getByRole("button", { name: "Use regular expression" }));
    fireEvent.change(screen.getByPlaceholderText("Filter by name"), { target: { value: "^DEEP" } });
    expect(screen.getByText("No files match")).toBeTruthy();
    changeLanguage("zh-CN");
    expect((screen.getByPlaceholderText("按名称筛选") as HTMLInputElement).value).toBe("^DEEP");
    expect(screen.getByText("没有匹配的文件")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "区分大小写" }));
    expect(await screen.findByText("deep.soql")).toBeTruthy();
    expect(screen.queryByText("a.soql")).toBeNull();
  });

  it("preserves expanded folders and an in-progress new folder / 保留展开文件夹与正在新建的文件夹", async () => {
    const { createDir } = await import("../fs/tree");
    const changeLanguage = language("en-US");
    showExplorer();
    fireEvent.click(await screen.findByText("queries"));
    expect(await screen.findByText("deep.soql")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = screen.getByPlaceholderText("folder name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "archive" } });
    changeLanguage("zh-CN");
    expect(screen.getByPlaceholderText("文件夹名称")).toBe(input);
    expect(input.value).toBe("archive");
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("deep.soql")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(createDir).toHaveBeenCalledWith("/ws", "archive");
  });

  it("localizes an empty workspace / 本地化空工作区", async () => {
    const { readTree } = await import("../fs/tree");
    vi.mocked(readTree).mockResolvedValueOnce([]);
    language("zh-CN");
    showExplorer();
    expect(await screen.findByText("暂无文件")).toBeTruthy();
  });

  it("updates the new-file placeholder without discarding input / 更新新文件占位文本且不丢失输入", async () => {
    const { createFile } = await import("../fs/tree");
    const changeLanguage = language("zh-CN");
    showExplorer();
    await screen.findByText("a.soql");
    fireEvent.click(screen.getByRole("button", { name: "新建文件" }));
    const input = screen.getByPlaceholderText("名称.soql") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "demo" } });
    changeLanguage("en-US");
    expect(screen.getByPlaceholderText("name.soql")).toBe(input);
    expect(input.value).toBe("demo");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(createFile).toHaveBeenCalledWith("/ws", "demo.soql");
  });

  it("updates an open context menu without closing it / 更新打开的上下文菜单且不关闭", async () => {
    const changeLanguage = language("en-US");
    showExplorer();
    fireEvent.contextMenu(await screen.findByText("queries"));
    expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
    changeLanguage("zh-CN");
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeTruthy();
  });
});
