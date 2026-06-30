// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFileTabs } from "./useFileTabs";
import { basename } from "../fs/paths";

vi.mock("../store", () => ({ getJson: vi.fn(), setJson: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../fs/save", () => ({ saveFile: vi.fn(), flushFiles: vi.fn() }));

import { getJson } from "../store";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { saveFile } from "../fs/save";

interface T {
  id: string;
  path: string;
  title: string;
  src: string;
}

// Deterministic ids so neighbor-selection assertions are stable.
let idc = 0;
const make = (path: string, content: string): T => ({
  id: `id${++idc}`,
  path,
  title: basename(path),
  src: content,
});

const setup = () =>
  renderHook(() => useFileTabs<T>({ tool: "apex", contentKey: "src", make }));

/** Mount, wait for the (null) hydrate to run, return the hook handle. */
async function mounted() {
  const h = setup();
  await waitFor(() => expect(getJson).toHaveBeenCalledWith("tabs.apex", null));
  return h;
}

const open = (r: { current: ReturnType<typeof useFileTabs<T>> }, path: string) =>
  act(async () => {
    await r.current.openFile(path);
  });

beforeEach(() => {
  vi.clearAllMocks();
  idc = 0;
  vi.mocked(getJson).mockResolvedValue(null as never);
  vi.mocked(readTextFile).mockResolvedValue("" as never);
  vi.mocked(writeTextFile).mockResolvedValue(undefined as never);
});

describe("useFileTabs", () => {
  it("starts empty when nothing is persisted", async () => {
    const { result } = await mounted();
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.active).toBeNull();
  });

  it("openFile adds a tab with content read from disk and activates it", async () => {
    vi.mocked(readTextFile).mockResolvedValue("SELECT Id" as never);
    const { result } = await mounted();
    await open(result, "/dir/a.apex");
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.path).toBe("/dir/a.apex");
    expect(result.current.active?.src).toBe("SELECT Id");
    expect(result.current.active?.title).toBe("a.apex");
  });

  it("opening an already-open path does not duplicate, just activates", async () => {
    const { result } = await mounted();
    await open(result, "/a.apex");
    await open(result, "/b.apex");
    await open(result, "/a.apex");
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.active?.path).toBe("/a.apex");
  });

  it("closing the active middle tab falls back to the left neighbor", async () => {
    const { result } = await mounted();
    await open(result, "/a.apex");
    await open(result, "/b.apex");
    await open(result, "/c.apex");
    const [a, b] = result.current.tabs;
    act(() => result.current.select(b.id));
    act(() => result.current.close(b.id));
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.active?.id).toBe(a.id);
  });

  it("newUntitled creates an in-memory tab with empty path", async () => {
    const { result } = await mounted();
    act(() => result.current.newUntitled());
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.path).toBe("");
  });

  it("patching content autosaves a saved tab but not an untitled one", async () => {
    const { result } = await mounted();
    await open(result, "/a.apex");
    act(() => result.current.patch(result.current.active!.id, { src: "new" }));
    expect(saveFile).toHaveBeenCalledWith("/a.apex", "new");

    vi.mocked(saveFile).mockClear();
    act(() => result.current.newUntitled());
    act(() => result.current.patch(result.current.active!.id, { src: "x" }));
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("hydrates persisted open paths, loading each file and the active one", async () => {
    vi.mocked(getJson).mockResolvedValue({
      openPaths: ["/a.apex", "/b.apex"],
      activePath: "/b.apex",
    } as never);
    vi.mocked(readTextFile).mockResolvedValue("loaded" as never);
    const { result } = setup();
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    expect(result.current.active?.path).toBe("/b.apex");
    expect(result.current.active?.src).toBe("loaded");
  });

  it("closeByPath removes the tab whose file was deleted", async () => {
    const { result } = await mounted();
    await open(result, "/a.apex");
    await open(result, "/b.apex");
    act(() => result.current.closeByPath("/a.apex"));
    expect(result.current.tabs.map((t) => t.path)).toEqual(["/b.apex"]);
  });

  it("restore re-inserts a previously closed tab and activates it", async () => {
    const { result } = await mounted();
    await open(result, "/a.apex");
    const tab = result.current.active!;
    act(() => result.current.close(tab.id));
    expect(result.current.tabs).toHaveLength(0);
    act(() => result.current.restore(tab));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.id).toBe(tab.id);
  });

  it("openOrReplace writes content and opens a fresh tab", async () => {
    const { result } = await mounted();
    await act(async () => {
      await result.current.openOrReplace("/n.apex", "body");
    });
    expect(writeTextFile).toHaveBeenCalledWith("/n.apex", "body");
    expect(result.current.active?.path).toBe("/n.apex");
    expect(result.current.active?.src).toBe("body");
  });

  it("retitle updates path and title on an open tab (rename/move)", async () => {
    const { result } = await mounted();
    await open(result, "/old.apex");
    act(() => result.current.retitle("/old.apex", "/dir/new.apex"));
    expect(result.current.active?.path).toBe("/dir/new.apex");
    expect(result.current.active?.title).toBe("new.apex");
  });

  it("save on an untitled tab prompts save-as, writes, and adopts the path", async () => {
    vi.mocked(saveDialog).mockResolvedValue("/picked.apex" as never);
    const { result } = await mounted();
    act(() => result.current.newUntitled());
    const id = result.current.active!.id;
    await act(async () => {
      await result.current.save(id);
    });
    expect(writeTextFile).toHaveBeenCalledWith("/picked.apex", "");
    expect(result.current.active?.path).toBe("/picked.apex");
    expect(result.current.active?.title).toBe("picked.apex");
  });
});
