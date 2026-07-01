import { describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso } from "./dateInput";

describe("dateInput", () => {
  it("round-trips a known instant through local input format", () => {
    const iso = "2026-05-11T05:52:56.000+0000";
    const local = isoToLocalInput(iso);
    const roundTripped = localInputToIso(local);
    expect(new Date(roundTripped).getTime()).toBe(new Date(iso).getTime());
  });

  it("round-trips a Z-suffixed instant", () => {
    const iso = "2026-05-11T05:52:56.000Z";
    const local = isoToLocalInput(iso);
    const roundTripped = localInputToIso(local);
    expect(new Date(roundTripped).getTime()).toBe(new Date(iso).getTime());
  });

  it("empty string maps to empty string both ways", () => {
    expect(isoToLocalInput("")).toBe("");
    expect(localInputToIso("")).toBe("");
  });

  it("invalid input maps to empty string", () => {
    expect(isoToLocalInput("not-a-date")).toBe("");
    expect(localInputToIso("not-a-date")).toBe("");
  });
});
