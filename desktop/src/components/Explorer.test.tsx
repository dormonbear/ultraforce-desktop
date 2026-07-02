// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
  renameNode: vi.fn(),
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
});
