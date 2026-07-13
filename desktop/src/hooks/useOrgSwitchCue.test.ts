// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOrgSwitchCue } from "./useOrgSwitchCue";

describe("useOrgSwitchCue", () => {
  it("stays at 0 before any org is selected", () => {
    const { result, rerender } = renderHook<number, { org: string | null }>(
      ({ org }) => useOrgSwitchCue(org),
      { initialProps: { org: null } },
    );
    expect(result.current).toBe(0);
    rerender({ org: null });
    expect(result.current).toBe(0);
  });

  it("does NOT fire on the initial null → org adoption (cold-start hydration)", () => {
    const { result, rerender } = renderHook<number, { org: string | null }>(
      ({ org }) => useOrgSwitchCue(org),
      { initialProps: { org: null } },
    );
    rerender({ org: "a@example.com" });
    expect(result.current).toBe(0);
  });

  it("does NOT fire for an org already selected at mount (remount)", () => {
    const { result, rerender } = renderHook<number, { org: string | null }>(
      ({ org }) => useOrgSwitchCue(org),
      { initialProps: { org: "a@example.com" } },
    );
    expect(result.current).toBe(0);
    rerender({ org: "a@example.com" });
    expect(result.current).toBe(0);
  });

  it("fires once per switch after adoption, never on a re-select of the same org", () => {
    const { result, rerender } = renderHook<number, { org: string | null }>(
      ({ org }) => useOrgSwitchCue(org),
      { initialProps: { org: null } },
    );

    rerender({ org: "a@example.com" }); // adoption: silent
    expect(result.current).toBe(0);

    // Re-select / reconnect the same org (config save, poll) must NOT re-fire.
    rerender({ org: "a@example.com" });
    rerender({ org: "a@example.com" });
    expect(result.current).toBe(0);

    // A real switch to another org fires once.
    rerender({ org: "b@example.com" });
    expect(result.current).toBe(1);

    // Same org again after the switch: no re-fire.
    rerender({ org: "b@example.com" });
    expect(result.current).toBe(1);
  });
});
