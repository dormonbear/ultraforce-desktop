import { describe, expect, it, vi } from "vitest";

const mem = new Map<string, unknown>();
vi.mock("./store", () => ({
  getJson: vi.fn(async (k: string, fb: unknown) => mem.get(k) ?? fb),
  setJson: vi.fn(async (k: string, v: unknown) => void mem.set(k, v)),
}));

async function fresh() {
  vi.resetModules();
  mem.clear();
  return import("./metrics");
}

describe("metrics", () => {
  it("bumps counters", async () => {
    const m = await fresh();
    await m.bump("run.soql");
    await m.bump("run.soql");
    await m.bump("run.apex", 3);
    const out = await m.readMetrics();
    expect(out.counters["run.soql"]).toBe(2);
    expect(out.counters["run.apex"]).toBe(3);
  });

  it("records durations and increments the matching counter", async () => {
    const m = await fresh();
    await m.timing("run.soql", 12.4);
    await m.timing("run.soql", 8.6);
    const out = await m.readMetrics();
    expect(out.counters["run.soql"]).toBe(2);
    expect(out.durations["run.soql"]).toEqual([12, 9]);
  });

  it("keeps only the last 50 duration samples", async () => {
    const m = await fresh();
    for (let i = 0; i < 60; i++) await m.timing("run.apex", i);
    const out = await m.readMetrics();
    expect(out.durations["run.apex"]).toHaveLength(50);
    expect(out.durations["run.apex"][0]).toBe(10); // 0..9 evicted
    expect(out.durations["run.apex"][49]).toBe(59);
  });
});
