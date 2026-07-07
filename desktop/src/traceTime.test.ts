import { afterEach, describe, expect, it, vi } from "vitest";
import { isoIn, isoPlusHours } from "./traceTime";

describe("traceTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats offsets from now as Salesforce UTC timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:15:30.000Z"));

    expect(isoIn(0)).toBe("2026-07-07T12:15:30.000+0000");
    expect(isoIn(0.5)).toBe("2026-07-07T12:45:30.000+0000");
  });

  it("adds whole hours to a base timestamp", () => {
    expect(isoPlusHours("2026-07-07T12:15:30.000+0000", 2)).toBe(
      "2026-07-07T14:15:30.000+0000",
    );
  });

  it("extends from now when the timestamp is empty or invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:15:30.000Z"));

    expect(isoPlusHours(null, 1)).toBe("2026-07-07T13:15:30.000+0000");
    expect(isoPlusHours("not-a-date", 2)).toBe("2026-07-07T14:15:30.000+0000");
  });
});
