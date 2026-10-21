// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { rename, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { useFileTabs } from "./useFileTabs";
import { renameNode, removeNode } from "../fs/tree";

vi.mock("../store", () => ({ getJson: async () => null, setJson: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: async () => "/old.apex" }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));

const make = (path: string, src: string) => ({
  id: "draft",
  title: "draft",
  path,
  src,
});

it("Save As follows an in-flight rename, including newer edits during its redirected write", async () => {
  const disk = new Map([["/old.apex", "previous file"]]);
  let finishRename!: () => void;
  let finishWrite!: () => void;
  vi.mocked(rename).mockImplementation(async () => {
    await new Promise<void>((r) => {
      finishRename = r;
    });
    disk.set("/new.apex", disk.get("/old.apex")!);
    disk.delete("/old.apex");
  });
  vi.mocked(writeTextFile).mockImplementation(async (path, content) => {
    if (content === "draft content")
      await new Promise<void>((r) => {
        finishWrite = r;
      });
    disk.set(String(path), content);
  });
  const { result } = renderHook(() =>
    useFileTabs({ tool: "apex", contentKey: "src", make }),
  );
  act(() => result.current.newUntitled());
  act(() => result.current.patch("draft", { src: "draft content" }));
  const moving = renameNode("/old.apex", "new.apex", result.current.retitle);
  await waitFor(() => expect(rename).toHaveBeenCalled());
  let saving!: Promise<void>;
  await act(async () => {
    saving = result.current.save("draft");
  });
  await act(async () => {
    finishRename();
    await moving;
  });
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled());
  act(() => result.current.patch("draft", { src: "latest edit" }));
  await act(async () => {
    finishWrite();
    await saving;
  });
  expect(disk.has("/old.apex")).toBe(false);
  expect(disk.get("/new.apex")).toBe("latest edit");
  expect(result.current.active?.path).toBe("/new.apex");
  expect(result.current.active?.src).toBe("latest edit");
});

it("Save As preserves its draft and rejects when deletion begins during the disk write", async () => {
  vi.clearAllMocks();
  const disk = new Map<string, string>();
  let finishWrite!: () => void;
  vi.mocked(writeTextFile).mockImplementation(async (path, content) => {
    if (content === "draft content")
      await new Promise<void>((r) => {
        finishWrite = r;
      });
    disk.set(String(path), content);
  });
  vi.mocked(remove).mockImplementation(async () => {
    disk.delete("/old.apex");
  });
  const { result } = renderHook(() =>
    useFileTabs({ tool: "apex", contentKey: "src", make }),
  );
  act(() => result.current.newUntitled());
  act(() => result.current.patch("draft", { src: "draft content" }));
  let saving!: Promise<void>;
  await act(async () => {
    saving = result.current.save("draft");
  });
  const outcome = saving.then(
    () => "success",
    (error: unknown) => error,
  );
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled());
  const deleting = removeNode("/old.apex", false, result.current.closeByPath);
  act(() => result.current.patch("draft", { src: "newer draft" }));
  let saved!: unknown;
  await act(async () => {
    finishWrite();
    await deleting;
    saved = await outcome;
  });
  expect(saved).toBeInstanceOf(Error);
  expect(disk.has("/old.apex")).toBe(false);
  expect(result.current.active?.path).toBe("");
  expect(result.current.active?.src).toBe("newer draft");
});

it("Save As adopts a rename registered while its original write is active", async () => {
  vi.clearAllMocks();
  const disk = new Map<string, string>();
  let finishWrite!: () => void;
  vi.mocked(writeTextFile).mockImplementation(async (path, content) => {
    if (content === "draft content")
      await new Promise<void>((r) => {
        finishWrite = r;
      });
    disk.set(String(path), content);
  });
  vi.mocked(rename).mockImplementation(async () => {
    disk.set("/new.apex", disk.get("/old.apex")!);
    disk.delete("/old.apex");
  });
  const { result } = renderHook(() =>
    useFileTabs({ tool: "apex", contentKey: "src", make }),
  );
  act(() => result.current.newUntitled());
  act(() => result.current.patch("draft", { src: "draft content" }));
  let saving!: Promise<void>;
  await act(async () => {
    saving = result.current.save("draft");
  });
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled());
  const moving = renameNode("/old.apex", "new.apex", result.current.retitle);
  act(() => result.current.patch("draft", { src: "newer draft" }));
  await act(async () => {
    finishWrite();
    await Promise.all([moving, saving]);
  });
  expect(disk.has("/old.apex")).toBe(false);
  expect(disk.get("/new.apex")).toBe("newer draft");
  expect(result.current.active?.path).toBe("/new.apex");
});
