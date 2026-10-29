// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { Explorer } from "./Explorer";
import type { TreeNode as Node } from "../fs/tree";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));

const fixture: Node[] = [
  {
    path: "/ws/queries",
    name: "queries",
    kind: "dir",
    children: [{ path: "/ws/queries/deep.soql", name: "deep.soql", kind: "file" }],
  },
  { path: "/ws/a.soql", name: "a.soql", kind: "file" },
];

vi.mock("../fs/tree", () => ({
  readTree: vi.fn(async () => fixture),
  createFile: vi.fn(),
  createDir: vi.fn(),
  renameNode: vi.fn(async (path: string) => path),
  removeNode: vi.fn(),
  moveNode: vi.fn(),
}));

function renderExplorer(onOpen = vi.fn()) {
  render(
    <Explorer
      root="/ws"
      ext="soql"
      activePath={null}
      onOpen={onOpen}
      onRenamed={() => {}}
      onRemoved={() => {}}
    />,
  );
  return onOpen;
}

describe("Explorer (headless-tree)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("renders the top level; collapsed dirs hide children", async () => {
    renderExplorer();
    expect(await screen.findByText("a.soql")).toBeTruthy();
    expect(screen.getByText("queries")).toBeTruthy();
    expect(screen.queryByText("deep.soql")).toBeNull();
  });

  it("clicking a folder expands it", async () => {
    renderExplorer();
    fireEvent.click(await screen.findByText("queries"));
    expect(await screen.findByText("deep.soql")).toBeTruthy();
  });

  it("clicking a file opens it", async () => {
    const onOpen = renderExplorer();
    fireEvent.click(await screen.findByText("a.soql"));
    expect(onOpen).toHaveBeenCalledWith("/ws/a.soql");
  });

  it("name filter reveals matches inside collapsed dirs", async () => {
    renderExplorer();
    await screen.findByText("a.soql");
    fireEvent.change(screen.getByPlaceholderText("Filter by name"), {
      target: { value: "deep" },
    });
    expect(await screen.findByText("deep.soql")).toBeTruthy();
    expect(screen.queryByText("a.soql")).toBeNull();
  });

  it("keeps inline rename focused after menu cleanup / 菜单清理后保留内联重命名焦点", async () => {
    const { renameNode } = await import("../fs/tree");
    renderExplorer();
    fireEvent.contextMenu(await screen.findByText("queries"));
    const rename = await screen.findByRole("menuitem", { name: "Rename" });
    vi.useFakeTimers();
    try {
      fireEvent.click(rename);
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      const input = screen.getByDisplayValue("queries");
      fireEvent.change(input, { target: { value: "archive" } });
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      expect(document.activeElement).toBe(input);
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      expect(renameNode).toHaveBeenCalledWith("/ws/queries", "archive", expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { menu: "New File", placeholder: "name.soql", row: true },
    { menu: "New Folder", placeholder: "folder name", row: true },
    { menu: "New File", placeholder: "name.soql", row: false },
    { menu: "New Folder", placeholder: "folder name", row: false },
  ])("keeps $menu input focused after menu cleanup (row=$row) / 菜单清理后保留新建输入焦点", async ({ menu, placeholder, row }) => {
    const { createFile, createDir } = await import("../fs/tree");
    renderExplorer();
    await screen.findByText("queries");
    fireEvent.contextMenu(row ? screen.getByText("queries") : screen.getByRole("tree"));
    const action = await screen.findByRole("menuitem", { name: menu });
    vi.useFakeTimers();
    try {
      fireEvent.click(action);
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      const input = screen.getByPlaceholderText(placeholder);
      expect(document.activeElement).toBe(input);
      fireEvent.change(input, { target: { value: "created" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      expect(menu === "New File" ? createFile : createDir).toHaveBeenCalledWith(
        row ? "/ws/queries" : "/ws", menu === "New File" ? "created.soql" : "created",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps direct F2 rename and Escape cancellation / 保留 F2 直接重命名及 Escape 取消", async () => {
    const { renameNode } = await import("../fs/tree");
    renderExplorer();
    const row = (await screen.findByText("queries")).closest<HTMLElement>('[role="treeitem"]')!;
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "F2", code: "F2" });
    fireEvent.keyUp(row, { key: "F2", code: "F2" });
    const input = screen.getByDisplayValue("queries");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "discarded" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    expect(screen.queryByDisplayValue("discarded")).toBeNull();
    expect(renameNode).not.toHaveBeenCalled();
  });

  it("moves DOM focus with tree keyboard navigation / 目录树键盘导航同步移动 DOM 焦点", async () => {
    renderExplorer();
    const row = await screen.findByRole("treeitem", { name: "queries" });
    fireEvent.click(row);
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyUp(document, { key: "ArrowDown", code: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "deep.soql" }));
  });

  it("does not let a renamed path reclaim later input focus / 已重命名路径不得夺回后续输入焦点", async () => {
    const { readTree, renameNode } = await import("../fs/tree");
    renderExplorer();
    const row = await screen.findByRole("treeitem", { name: "a.soql" });
    fireEvent.click(row);
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "F2", code: "F2" });
    fireEvent.keyUp(row, { key: "F2", code: "F2" });
    fireEvent.change(screen.getByDisplayValue("a.soql"), { target: { value: "b.soql" } });
    vi.mocked(renameNode).mockResolvedValue("/ws/b.soql");
    vi.mocked(readTree).mockResolvedValue([fixture[0], { path: "/ws/b.soql", name: "b.soql", kind: "file" }]);
    vi.useFakeTimers();
    try {
      fireEvent.keyDown(screen.getByDisplayValue("b.soql"), { key: "Enter", code: "Enter" });
      fireEvent.keyUp(document, { key: "Enter", code: "Enter" });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText("b.soql")).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "b.soql" }));
      fireEvent.contextMenu(screen.getByText("queries"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const input = screen.getByDisplayValue("queries");
      fireEvent.change(input, { target: { value: "archive" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(document.activeElement).toBe(input);
      expect(screen.getByDisplayValue("archive")).toBe(input);
    } finally {
      vi.useRealTimers();
      vi.mocked(readTree).mockResolvedValue(fixture);
      vi.mocked(renameNode).mockImplementation(async (path: string) => path);
    }
  });

  it.each(["filter", "tree"])("preserves newer %s focus while a disk rename completes / 磁盘重命名完成时保留后续焦点", async (focus) => {
    const { readTree, renameNode } = await import("../fs/tree");
    let finish!: (path: string) => void;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    renderExplorer();
    const row = await screen.findByRole("treeitem", { name: "a.soql" });
    fireEvent.click(row);
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "F2", code: "F2" });
    fireEvent.keyUp(row, { key: "F2", code: "F2" });
    const input = screen.getByDisplayValue("a.soql");
    fireEvent.change(input, { target: { value: "b.soql" } });
    vi.mocked(renameNode).mockReturnValueOnce(pending);
    vi.mocked(readTree).mockResolvedValue([fixture[0], { path: "/ws/b.soql", name: "b.soql", kind: "file" }]);
    try {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      fireEvent.keyUp(document, { key: "Enter", code: "Enter" });
      const target = focus === "filter" ? screen.getByPlaceholderText("Filter by name") : screen.getByRole("treeitem", { name: "queries" });
      if (focus === "tree") fireEvent.click(target);
      act(() => target.focus());
      await act(async () => { finish("/ws/b.soql"); await pending; });
      expect(screen.getByText("b.soql")).toBeTruthy();
      expect(document.activeElement).toBe(target);
      if (focus === "tree") {
        fireEvent.keyDown(target, { key: "ArrowDown", code: "ArrowDown" });
        fireEvent.keyUp(document, { key: "ArrowDown", code: "ArrowDown" });
        expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "deep.soql" }));
      }
    } finally {
      vi.mocked(readTree).mockResolvedValue(fixture);
    }
  });
});
