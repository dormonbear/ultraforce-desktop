import { describe, it, expect, vi } from "vitest";
import { sortEntries, renameNode, removeNode, moveNode } from "./tree";
import { __setWriter, saveFile, flushFiles } from "./save";
import { rename, remove } from "@tauri-apps/plugin-fs";

vi.mock("@tauri-apps/plugin-fs", () => ({
  rename: vi.fn(),
  remove: vi.fn(),
  writeTextFile: vi.fn(),
}));

describe("sortEntries", () => {
  it("dirs first, then files, each name-sorted", () => {
    const out = sortEntries([
      { name: "b.soql", isDirectory: false },
      { name: "Zfolder", isDirectory: true },
      { name: "a.soql", isDirectory: false },
      { name: "Afolder", isDirectory: true },
    ]);
    expect(out.map((e) => e.name)).toEqual([
      "Afolder",
      "Zfolder",
      "a.soql",
      "b.soql",
    ]);
  });
});

describe("path mutations with active autosaves", () => {
  it.each(["rename", "move", "delete"])(
    "%s waits before changing disk and notifying tabs",
    async (operation) => {
      vi.useFakeTimers();
      const disk = new Map<string, string>();
      let finish!: () => void;
      const changed = vi.fn();
      __setWriter(async (path, content) => {
        await new Promise<void>((r) => {
          finish = r;
        });
        disk.set(path, content);
      });
      vi.mocked(rename).mockImplementation(async (from, to) => {
        disk.set(String(to), disk.get(String(from))!);
        disk.delete(String(from));
      });
      vi.mocked(remove).mockImplementation(async (path) => {
        disk.delete(String(path));
      });
      saveFile("/old/a.apex", "latest");
      await vi.advanceTimersByTimeAsync(400);
      const request =
        operation === "rename"
          ? renameNode("/old/a.apex", "renamed.apex", changed)
          : operation === "move"
            ? moveNode("/old/a.apex", "/new", changed)
            : removeNode("/old/a.apex", false, changed);
      await vi.advanceTimersByTimeAsync(0);
      const notifiedEarly = changed.mock.calls.length;
      finish();
      await request;
      await flushFiles();
      vi.useRealTimers();
      expect(notifiedEarly).toBe(0);
      expect(disk.has("/old/a.apex")).toBe(false);
      if (operation !== "delete")
        expect([...disk.values()]).toEqual(["latest"]);
      expect(changed).toHaveBeenCalledTimes(1);
    },
  );
});
