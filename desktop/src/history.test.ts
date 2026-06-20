import { beforeEach, describe, expect, it, vi } from "vitest";

// Back ./store with an in-memory map so history logic is tested in isolation.
const mem = new Map<string, unknown>();
vi.mock("./store", () => ({
  getJson: vi.fn(async (k: string, fb: unknown) => mem.get(k) ?? fb),
  setJson: vi.fn(async (k: string, v: unknown) => void mem.set(k, v)),
}));

// Import after the mock is registered, and reset module cache per test so the
// module-level history cache does not leak between cases.
async function fresh() {
  vi.resetModules();
  mem.clear();
  return import("./history");
}

beforeEach(() => {
  globalThis.crypto ??= {} as Crypto;
  let n = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () => `id-${n++}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});

describe("history", () => {
  it("records newest-first", async () => {
    const h = await fresh();
    await h.recordHistory({ tool: "soql", org: "a", text: "q1", status: "success", durationMs: 5 });
    await h.recordHistory({ tool: "soql", org: "a", text: "q2", status: "success", durationMs: 6 });
    const list = await h.listHistory();
    expect(list.map((e) => e.text)).toEqual(["q2", "q1"]);
  });

  it("caps at 200 entries (FIFO drop of oldest)", async () => {
    const h = await fresh();
    for (let i = 0; i < 205; i++) {
      await h.recordHistory({ tool: "apex", org: null, text: `r${i}`, status: "success", durationMs: 1 });
    }
    const list = await h.listHistory();
    expect(list).toHaveLength(200);
    expect(list[0].text).toBe("r204"); // newest
    expect(list[199].text).toBe("r5"); // r0..r4 dropped
  });

  it("clears and notifies subscribers", async () => {
    const h = await fresh();
    const seen: number[] = [];
    h.onHistory((e) => seen.push(e.length));
    await h.recordHistory({ tool: "soql", org: null, text: "x", status: "error", durationMs: 2 });
    await h.clearHistory();
    expect(await h.listHistory()).toHaveLength(0);
    expect(seen).toEqual([1, 0]);
  });
});
