// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { FileTabsPanel } from "./FileTabsPanel";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
const tab = {
  id: "one",
  path: "/query.soql",
  title: "query.soql",
  query: "SELECT Id FROM Account",
};
vi.mock("./useFileTabs", () => ({
  useFileTabs: () => ({ tabs: [tab], active: tab, activeId: tab.id, save }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../fs/workspace", () => ({ getRoot: async () => null }));
vi.mock("../panels/useSidebarSync", () => ({ useSidebarSync: () => ({}) }));
vi.mock("../components/Explorer", () => ({ Explorer: () => null }));
vi.mock("./TabStrip", () => ({ TabStrip: () => null }));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => null,
}));

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  render(
    <FileTabsPanel
      tool="soql"
      ext="soql"
      contentKey="query"
      make={() => tab}
      ariaLabel="Queries"
      emptyHint="No queries"
      newLabel="New query"
      renderView={({ onSave }) => <button onClick={onSave}>Save</button>}
    />,
  );
}

describe("file tab Save", () => {
  it.each([
    ["en", "This file is already open. Save its tab or choose another path.", "This file is already open. Save its tab or choose another path."],
    ["zh-CN", "This file is already open. Save its tab or choose another path.", "此文件已打开。请保存对应标签页或选择其他路径。"],
    ["en", "File was deleted while saving. Choose another path.", "File was deleted while saving. Choose another path."],
    ["zh-CN", "File was deleted while saving. Choose another path.", "保存时文件已被删除。请选择其他路径。"],
  ])("localizes save error in %s / 本地化保存错误", async (locale, message, expected) => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    save.mockRejectedValue(new Error(message));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expected));
  });

  it("shows write errors instead of leaving an unhandled rejection", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    save.mockRejectedValue(new Error("Disk full"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Disk full"));
  });

  it("saves the active tab without showing an error on success", async () => {
    save.mockResolvedValue(undefined);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(tab.id));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
