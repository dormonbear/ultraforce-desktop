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
vi.mock("../fs/save", () => ({
  saveFile: vi.fn(),
  flushFiles: vi.fn(),
  writeFileNow: vi.fn(),
}));

import { getJson, setJson } from "../store";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { saveFile, writeFileNow } from "../fs/save";

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

const open = (
  r: { current: ReturnType<typeof useFileTabs<T>> },
  path: string,
) =>
  act(async () => {
    await r.current.openFile(path);
  });

beforeEach(() => {
  vi.clearAllMocks();
  idc = 0;
  vi.mocked(getJson).mockResolvedValue(null as never);
  vi.mocked(readTextFile).mockResolvedValue("" as never);
  vi.mocked(writeFileNow).mockImplementation(async (path, content) => {
    await writeTextFile(path, content);
    return path;
  });
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

  it("coalesces concurrent opens of the same file into one tab and disk read", async () => {
    let finishRead!: (content: string) => void;
    vi.mocked(readTextFile).mockReturnValue(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    const { result } = await mounted();
    await act(async () => {
      const first = result.current.openFile("/a.apex", 7);
      const second = result.current.openFile("/a.apex", 42);
      finishRead("body");
      await Promise.all([first, second]);
    });
    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.src).toBe("body");
    expect(result.current.reveal?.line).toBe(42);
    expect(result.current.reveal?.id).toBe(result.current.activeId);
  });

  it("allows retrying an open after a failed disk read", async () => {
    const { result } = await mounted();
    vi.mocked(readTextFile).mockRejectedValueOnce(
      new Error("File unavailable"),
    );
    await act(async () => {
      await expect(result.current.openFile("/a.apex")).rejects.toThrow(
        "File unavailable",
      );
    });
    expect(result.current.tabs).toHaveLength(0);
    vi.mocked(readTextFile).mockResolvedValueOnce("restored");
    await open(result, "/a.apex");
    expect(result.current.active?.src).toBe("restored");
  });

  it("keeps the active tab valid when reopened before React commits", async () => {
    const { result } = await mounted();
    await act(async () => {
      await result.current.openFile("/a.apex");
      await result.current.openFile("/a.apex");
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.id).toBe(result.current.tabs[0].id);
    expect(readTextFile).toHaveBeenCalledTimes(1);
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

  it("keeps a new draft and its focus when startup restoration finishes late", async () => {
    let restore!: (saved: unknown) => void;
    vi.mocked(getJson).mockReturnValue(
      new Promise((resolve) => {
        restore = resolve;
      }),
    );
    const { result } = setup();
    act(() => result.current.newUntitled());
    const draftId = result.current.activeId!;
    act(() => result.current.patch(draftId, { src: "unsaved work" }));
    await act(async () => {
      restore({ openPaths: ["/saved.apex"], activePath: "/saved.apex" });
    });
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.active?.id).toBe(draftId);
    expect(result.current.active?.src).toBe("unsaved work");
    expect(result.current.tabs.some((t) => t.path === "/saved.apex")).toBe(
      true,
    );
  });

  it("preserves an already-open file's identity and edits over stale startup content", async () => {
    let restore!: (saved: unknown) => void;
    vi.mocked(getJson).mockReturnValue(
      new Promise((resolve) => {
        restore = resolve;
      }),
    );
    const { result } = setup();
    await open(result, "/a.apex");
    const id = result.current.activeId!;
    act(() => result.current.patch(id, { src: "new edit" }));
    vi.mocked(readTextFile).mockResolvedValue("old disk content");
    await act(async () => {
      restore({ openPaths: ["/a.apex"], activePath: "/a.apex" });
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.id).toBe(id);
    expect(result.current.active?.src).toBe("new edit");
  });

  it("does not let a cancelled restore enable persistence prematurely", async () => {
    const restores: ((saved: unknown) => void)[] = [];
    vi.mocked(getJson).mockImplementation(
      () =>
        new Promise((resolve) => {
          restores.push(resolve);
        }),
    );
    const { result, rerender } = renderHook(
      ({ factory }) =>
        useFileTabs<T>({ tool: "apex", contentKey: "src", make: factory }),
      { initialProps: { factory: make } },
    );
    rerender({ factory: (path, content) => make(path, content) });
    expect(restores).toHaveLength(2);
    await act(async () => {
      restores[0](null);
    });
    act(() => result.current.newUntitled());
    const writesBeforeRestore = vi.mocked(setJson).mock.calls.length;
    await act(async () => {
      restores[1]({ openPaths: ["/saved.apex"], activePath: "/saved.apex" });
    });
    expect(writesBeforeRestore).toBe(0);
    expect(result.current.tabs.some((t) => t.path === "/saved.apex")).toBe(
      true,
    );
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

describe("delayed explicit writes", () => {
  it("persists live open paths when an empty startup store response arrives late", async () => {
    let restore!: (value: unknown) => void;
    vi.mocked(getJson).mockReturnValueOnce(
      new Promise((r) => {
        restore = r;
      }),
    );
    const { result } = setup();
    await open(result, "/live.apex");
    expect(setJson).not.toHaveBeenCalled();
    await act(async () => {
      restore(null);
    });
    expect(setJson).toHaveBeenCalledWith("tabs.apex", {
      openPaths: ["/live.apex"],
      activePath: "/live.apex",
    });
  });

  it("does not restore a closed path when the startup store response arrives late", async () => {
    let restore!: (value: unknown) => void;
    vi.mocked(getJson).mockReturnValueOnce(
      new Promise((r) => {
        restore = r;
      }),
    );
    const { result } = setup();
    await open(result, "/closed.apex");
    act(() => result.current.close(result.current.activeId!));
    await act(async () => {
      restore({ openPaths: ["/closed.apex"], activePath: "/closed.apex" });
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeId).toBeNull();
  });

  it("keeps a failed Save As draft and retries with its latest content", async () => {
    vi.mocked(saveDialog).mockResolvedValue("/picked.apex");
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error("Disk full"));
    const { result } = await mounted();
    act(() => result.current.newUntitled());
    const id = result.current.activeId!;
    act(() => result.current.patch(id, { src: "keep me" }));
    await act(async () => {
      await expect(result.current.save(id)).rejects.toThrow("Disk full");
    });
    expect(result.current.active?.path).toBe("");
    expect(result.current.active?.src).toBe("keep me");
    act(() => result.current.patch(id, { src: "latest retry" }));
    await act(async () => {
      await result.current.save(id);
    });
    expect(writeTextFile).toHaveBeenLastCalledWith(
      "/picked.apex",
      "latest retry",
    );
    expect(result.current.active?.path).toBe("/picked.apex");
  });

  it("coalesces concurrent Save As requests", async () => {
    let pick!: (path: string) => void;
    vi.mocked(saveDialog).mockReturnValue(
      new Promise((r) => {
        pick = r;
      }),
    );
    const { result } = await mounted();
    act(() => result.current.newUntitled());
    await act(async () => {
      const first = result.current.save(result.current.activeId!);
      const second = result.current.save(result.current.activeId!);
      pick("/picked.apex");
      await Promise.all([first, second]);
    });
    expect(saveDialog).toHaveBeenCalledTimes(1);
    expect(writeTextFile).toHaveBeenCalledTimes(1);
  });

  it.each(["rename", "delete"])(
    "does not publish a pending subtree open after %s",
    async (kind) => {
      let finish!: (content: string) => void;
      const { result } = await mounted();
      vi.mocked(readTextFile).mockReturnValueOnce(
        new Promise((r) => {
          finish = r;
        }),
      );
      let opening!: Promise<void>;
      act(() => {
        opening = result.current.openFile("/dir/a.apex");
      });
      act(() => {
        if (kind === "rename") result.current.retitle("/dir", "/new");
        else result.current.closeByPath("/dir");
      });
      await act(async () => {
        finish("stale read");
        await opening;
      });
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.activeId).toBeNull();
    },
  );

  it("does not resurrect a tab closed during startup read", async () => {
    let finish!: (content: string) => void;
    vi.mocked(getJson).mockResolvedValue({
      openPaths: ["/a.apex"],
      activePath: "/a.apex",
    });
    vi.mocked(readTextFile).mockReturnValueOnce(
      new Promise((r) => {
        finish = r;
      }),
    );
    const { result } = setup();
    await waitFor(() => expect(readTextFile).toHaveBeenCalled());
    vi.mocked(readTextFile).mockResolvedValue("live");
    await open(result, "/a.apex");
    act(() => result.current.close(result.current.activeId!));
    await act(async () => {
      finish("stale");
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeId).toBeNull();
  });

  it("saves edits made while Save As dialog and IO are pending", async () => {
    let pick!: (path: string) => void;
    let finish!: () => void;
    vi.mocked(saveDialog).mockReturnValue(
      new Promise((r) => {
        pick = r;
      }),
    );
    vi.mocked(writeTextFile).mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const { result } = await mounted();
    act(() => result.current.newUntitled());
    const id = result.current.activeId!;
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.save(id);
    });
    act(() => result.current.patch(id, { src: "during dialog" }));
    await act(async () => {
      pick("/picked.apex");
    });
    act(() => result.current.patch(id, { src: "during IO" }));
    await act(async () => {
      finish();
      await saving;
    });
    expect(writeTextFile).toHaveBeenNthCalledWith(
      1,
      "/picked.apex",
      "during dialog",
    );
    expect(writeTextFile).toHaveBeenLastCalledWith("/picked.apex", "during IO");
    expect(result.current.active?.src).toBe("during IO");
    expect(result.current.active?.path).toBe("/picked.apex");
  });

  it("keeps edits made after history replacement starts and has one tab", async () => {
    let finish!: () => void;
    vi.mocked(writeTextFile).mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const { result } = await mounted();
    await open(result, "/a.apex");
    let replacing!: Promise<void>;
    act(() => {
      replacing = result.current.openOrReplace("/a.apex", "history");
    });
    act(() =>
      result.current.patch(result.current.activeId!, { src: "newer edit" }),
    );
    await act(async () => {
      finish();
      await replacing;
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.src).toBe("newer edit");
  });

  it("retitles and closes directory descendants before React commits", async () => {
    const { result } = await mounted();
    await open(result, "/dir/a.apex");
    await open(result, "/directory/b.apex");
    act(() => {
      result.current.retitle("/dir", "/moved");
      result.current.patch(result.current.tabs[0].id, { src: "latest" });
    });
    expect(saveFile).toHaveBeenLastCalledWith("/moved/a.apex", "latest");
    act(() => result.current.closeByPath("/moved"));
    expect(result.current.tabs.map((t) => t.path)).toEqual([
      "/directory/b.apex",
    ]);
  });
});
