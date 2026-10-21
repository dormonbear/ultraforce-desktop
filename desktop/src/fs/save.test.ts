import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  saveFile,
  flushFiles,
  __setWriter,
  mutateFiles,
  writeFileNow,
} from "./save";

describe("saveFile", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid writes per path", async () => {
    const writes: [string, string][] = [];
    __setWriter(async (p, c) => {
      writes.push([p, c]);
    });
    saveFile("/a.soql", "v1");
    saveFile("/a.soql", "v2");
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual([["/a.soql", "v2"]]);
  });

  it("flushFiles writes pending immediately", async () => {
    const writes: [string, string][] = [];
    __setWriter(async (p, c) => {
      writes.push([p, c]);
    });
    saveFile("/b.soql", "x");
    await flushFiles();
    expect(writes).toEqual([["/b.soql", "x"]]);
  });

  it("serializes slow writes so an older save cannot overwrite a newer edit", async () => {
    let finishFirst!: () => void;
    let disk = "";
    const writes: string[] = [];
    __setWriter(async (_path, content) => {
      writes.push(content);
      if (content === "old")
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
      disk = content;
    });
    saveFile("/slow.soql", "old");
    await vi.advanceTimersByTimeAsync(400);
    saveFile("/slow.soql", "new");
    await vi.advanceTimersByTimeAsync(400);
    // Record the overlap before releasing the first write, so even the broken
    // implementation leaves no asynchronous work behind after this test.
    const beforeRelease = [...writes];
    finishFirst();
    await flushFiles();
    expect(disk).toBe("new");
    expect(beforeRelease).toEqual(["old"]);
    expect(writes).toEqual(["old", "new"]);
  });

  it("flush waits for a write that already passed its debounce", async () => {
    let finish!: () => void;
    __setWriter(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    saveFile("/in-flight.soql", "body");
    await vi.advanceTimersByTimeAsync(400);
    let flushed = false;
    const flushing = flushFiles().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    const completedEarly = flushed;
    finish();
    await flushing;
    expect(completedEarly).toBe(false);
    expect(flushed).toBe(true);
  });

  it("lets different files save independently", async () => {
    let finish!: () => void;
    const writes: string[] = [];
    __setWriter(async (path) => {
      writes.push(path);
      if (path === "/blocked.soql")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    });
    saveFile("/blocked.soql", "one");
    saveFile("/independent.soql", "two");
    await vi.advanceTimersByTimeAsync(400);
    const started = [...writes];
    finish();
    await flushFiles();
    expect(started).toEqual(["/blocked.soql", "/independent.soql"]);
  });

  it("flush queues the newest pending edit behind an active write", async () => {
    let finish!: () => void;
    const writes: string[] = [];
    __setWriter(async (_path, content) => {
      writes.push(content);
      if (content === "old")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    });
    saveFile("/flush-order.soql", "old");
    await vi.advanceTimersByTimeAsync(400);
    saveFile("/flush-order.soql", "new");
    const flushing = flushFiles();
    await vi.advanceTimersByTimeAsync(0);
    const beforeRelease = [...writes];
    finish();
    await flushing;
    expect(beforeRelease).toEqual(["old"]);
    expect(writes).toEqual(["old", "new"]);
  });

  it("does not poison newer queued edits when an older write fails", async () => {
    let failFirst!: (error: Error) => void;
    let disk = "";
    __setWriter(async (_path, content) => {
      if (content === "old")
        await new Promise<void>((_resolve, reject) => {
          failFirst = reject;
        });
      disk = content;
    });
    saveFile("/retry.soql", "old");
    await vi.advanceTimersByTimeAsync(400);
    saveFile("/retry.soql", "new");
    await vi.advanceTimersByTimeAsync(400);
    failFirst(new Error("Temporary write failure"));
    await flushFiles();
    expect(disk).toBe("new");
  });

  it("reports an earlier background write failure on flush until a later save succeeds", async () => {
    const failure = new Error("Disk full");
    __setWriter(async () => {
      throw failure;
    });
    saveFile("/failed.soql", "body");
    await vi.advanceTimersByTimeAsync(400);
    await expect(flushFiles()).rejects.toBe(failure);
    const retry = vi.fn(async () => {});
    __setWriter(retry);
    saveFile("/failed.soql", "new body");
    await flushFiles();
    expect(retry).toHaveBeenCalledExactlyOnceWith("/failed.soql", "new body");
  });

  it("orders an explicit replacement after an older active autosave", async () => {
    let finish!: () => void;
    let disk = "";
    __setWriter(async (_path, content) => {
      if (content === "old")
        await new Promise<void>((r) => {
          finish = r;
        });
      disk = content;
    });
    saveFile("/replace.apex", "old");
    await vi.advanceTimersByTimeAsync(400);
    const replacing = writeFileNow("/replace.apex", "history");
    finish();
    await replacing;
    expect(disk).toBe("history");
  });

  it.each(["rename", "delete"])(
    "buffers edits during %s and never resurrects the old path",
    async (kind) => {
      let finishWrite!: () => void;
      let finishMutation!: () => void;
      const disk = new Map<string, string>();
      __setWriter(async (path, content) => {
        if (content === "old")
          await new Promise<void>((r) => {
            finishWrite = r;
          });
        disk.set(path, content);
      });
      saveFile("/dir/a.apex", "old");
      await vi.advanceTimersByTimeAsync(400);
      let started = false;
      const mutating = mutateFiles(
        "/dir",
        kind === "rename" ? "/new" : null,
        async () => {
          started = true;
          await new Promise<void>((r) => {
            finishMutation = r;
          });
          if (kind === "rename")
            disk.set("/new/a.apex", disk.get("/dir/a.apex")!);
          disk.delete("/dir/a.apex");
        },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(false);
      finishWrite();
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(true);
      saveFile("/dir/a.apex", "during mutation");
      await vi.advanceTimersByTimeAsync(400);
      expect(disk.get("/dir/a.apex")).toBe("old");
      finishMutation();
      await mutating;
      await flushFiles();
      expect(disk.has("/dir/a.apex")).toBe(false);
      if (kind === "rename")
        expect(disk.get("/new/a.apex")).toBe("during mutation");
    },
  );

  it("resumes buffered edits after a failed mutation", async () => {
    let fail!: (reason: Error) => void;
    let disk = "";
    __setWriter(async (_path, content) => {
      disk = content;
    });
    const moving = mutateFiles(
      "/old.apex",
      "/new.apex",
      () =>
        new Promise((_r, reject) => {
          fail = reject;
        }),
    );
    const rejected = expect(moving).rejects.toThrow("rename failed");
    await vi.advanceTimersByTimeAsync(0);
    saveFile("/old.apex", "retained");
    fail(new Error("rename failed"));
    await rejected;
    await flushFiles();
    expect(disk).toBe("retained");
  });

  it("does not let an unrelated file failure block explicit Save", async () => {
    __setWriter(async (path) => {
      if (path === "/unavailable.apex") throw new Error("Unrelated failure");
    });
    saveFile("/unavailable.apex", "unavailable");
    await vi.advanceTimersByTimeAsync(400);
    await expect(
      writeFileNow("/healthy.apex", "safe"),
    ).resolves.toBe("/healthy.apex");
    // Recover the synthetic failure so module state does not leak to tests.
    __setWriter(async () => {});
    await writeFileNow("/unavailable.apex", "retry");
  });

  it("explicit Save during rename waits for its redirected write", async () => {
    let finishRename!: () => void;
    let finishWrite!: () => void;
    let flushed = false;
    const writes: string[] = [];
    __setWriter((path) => {
      writes.push(path);
      return new Promise<void>((r) => {
        finishWrite = r;
      });
    });
    const moving = mutateFiles(
      "/before.apex",
      "/after.apex",
      () =>
        new Promise((r) => {
          finishRename = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const saving = writeFileNow("/before.apex", "live").then(() => {
      flushed = true;
    });
    finishRename();
    await moving;
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    expect(writes).toEqual(["/after.apex"]);
    finishWrite();
    await saving;
    expect(flushed).toBe(true);
  });
});
