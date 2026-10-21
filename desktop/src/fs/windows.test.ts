import { afterEach, expect, it, vi } from "vitest";
import { resolveRoot } from "./workspace";
import { createFile, readTree, renameNode, moveNode, removeNode } from "./tree";
import { __setWriter, flushFiles, saveFile } from "./save";
import { readDir, rename, writeTextFile } from "@tauri-apps/plugin-fs";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  writeTextFile: vi.fn(),
}));

afterEach(async () => {
  await flushFiles();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it.each([
  "C:\\Users\\fixture\\AppData\\Roaming\\tool\\",
  "\\\\server\\share\\tool\\",
])("keeps native appData root %s through explorer IO", async (appData) => {
  const root = resolveRoot("soql", null, appData);
  const expected = appData + "workspace\\soql";
  expect(root).toBe(expected);
  vi.mocked(readDir).mockResolvedValue([
    { name: "query.soql", isDirectory: false, isFile: true, isSymlink: false },
  ]);
  expect(await readTree(root)).toEqual([
    { name: "query.soql", path: expected + "\\query.soql", kind: "file" },
  ]);
  await createFile(root, "new.soql");
  expect(writeTextFile).toHaveBeenCalledWith(expected + "\\new.soql", "");
  const moved = await moveNode(expected + "\\new.soql", appData + "archive");
  expect(moved).toBe(appData + "archive\\new.soql");
  const renamed = await renameNode(moved, "renamed.soql");
  expect(renamed).toBe(appData + "archive\\renamed.soql");
  expect(rename).toHaveBeenLastCalledWith(moved, renamed);
});

it.each(["C:\\workspace", "\\\\server\\share\\workspace"])(
  "drains and redirects descendant saves across rename of %s",
  async (root) => {
    vi.useFakeTimers();
    const disk = new Map<string, string>();
    __setWriter(async (p, content) => {
      disk.set(p, content);
    });
    const path = root + "\\child\\a.soql";
    let release!: () => void;
    let begin!: () => void;
    const begun = new Promise<void>((r) => {
      begin = r;
    });
    vi.mocked(rename).mockImplementation(async () => {
      begin();
      await new Promise<void>((r) => {
        release = r;
      });
      const value = disk.get(path);
      disk.delete(path);
      if (value !== undefined) disk.set(root + "\\renamed\\a.soql", value);
    });
    saveFile(path, "before");
    const moving = renameNode(root + "\\child", "renamed");
    await begun;
    const beforeMutation = disk.get(path);
    saveFile(path, "during");
    release();
    await moving;
    await flushFiles();
    expect(beforeMutation).toBe("before");
    expect(disk.has(path)).toBe(false);
    expect(disk.get(root + "\\renamed\\a.soql")).toBe("during");
    await removeNode(root + "\\renamed", true);
  },
);

it("coalesces Windows separator and drive-letter variants in the writer", async () => {
  vi.useFakeTimers();
  const writes: [string, string][] = [];
  __setWriter(async (path, content) => {
    writes.push([path, content]);
  });
  saveFile("c:/workspace/a.soql", "old");
  saveFile("C:\\workspace\\a.soql", "latest");
  await flushFiles("C:/workspace/a.soql");
  expect(writes).toEqual([["C:\\workspace\\a.soql", "latest"]]);
});

it("retains a Windows write failure across separator spellings and aborts rename until retry", async () => {
  const failure = new Error("Synthetic disk full");
  __setWriter(async () => {
    throw failure;
  });
  saveFile("c:/workspace/failure.soql", "body");
  await expect(flushFiles("C:\\workspace\\failure.soql")).rejects.toBe(failure);
  await expect(
    renameNode("C:/workspace/failure.soql", "retry.soql"),
  ).rejects.toBe(failure);
  expect(rename).not.toHaveBeenCalled();
  __setWriter(async () => {});
  saveFile("C:\\workspace\\failure.soql", "retry");
  await flushFiles();
  await renameNode("c:/workspace/failure.soql", "retry.soql");
  expect(rename).toHaveBeenCalledWith(
    "C:\\workspace\\failure.soql",
    "C:\\workspace\\retry.soql",
  );
});

it("drops edits buffered during native subtree deletion without touching a sibling prefix", async () => {
  vi.useFakeTimers();
  const disk = new Map<string, string>();
  __setWriter(async (path, content) => {
    disk.set(path, content);
  });
  let release!: () => void;
  let begin!: () => void;
  const begun = new Promise<void>((r) => {
    begin = r;
  });
  const { remove } = await import("@tauri-apps/plugin-fs");
  vi.mocked(remove).mockImplementation(async () => {
    begin();
    await new Promise<void>((r) => {
      release = r;
    });
    disk.delete("C:\\workspace\\folder\\a.soql");
  });
  saveFile("C:\\workspace\\folder\\a.soql", "old");
  saveFile("C:\\workspace\\folder-other\\b.soql", "sibling");
  const deleting = removeNode("C:/workspace/folder", true);
  await begun;
  saveFile("C:/workspace/folder/a.soql", "during");
  release();
  await deleting;
  await flushFiles();
  expect([...disk]).toEqual([
    ["C:\\workspace\\folder-other\\b.soql", "sibling"],
  ]);
});
