import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveFile, flushFiles, __setWriter } from "./save";

describe("saveFile", () => {
  beforeEach(() => vi.useFakeTimers());

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
});
