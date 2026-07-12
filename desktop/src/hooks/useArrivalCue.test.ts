// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useArrivalCue } from "./useArrivalCue";

describe("useArrivalCue", () => {
  it("stays at 0 while the token is null (nothing to cue)", () => {
    const { result, rerender } = renderHook<number, { t: unknown }>(
      ({ t }) => useArrivalCue(t),
      { initialProps: { t: null } },
    );
    expect(result.current).toBe(0);
    rerender({ t: null });
    expect(result.current).toBe(0);
  });

  it("fires on the mount token (first result mounts the consumer fresh)", () => {
    const first = { id: 1 };
    const { result } = renderHook<number, { t: unknown }>(
      ({ t }) => useArrivalCue(t),
      { initialProps: { t: first } },
    );
    expect(result.current).toBe(1);
  });

  it("increments once per new identity, never per render", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const { result, rerender } = renderHook<number, { t: unknown }>(
      ({ t }) => useArrivalCue(t),
      { initialProps: { t: null } },
    );
    expect(result.current).toBe(0);

    rerender({ t: a });
    expect(result.current).toBe(1);

    // Same identity across many re-renders (scroll/sort/filter) must NOT re-fire.
    rerender({ t: a });
    rerender({ t: a });
    expect(result.current).toBe(1);

    rerender({ t: b });
    expect(result.current).toBe(2);
  });

  it("does not fire when the token goes null (cancel/error) but arms the next arrival", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const { result, rerender } = renderHook<number, { t: unknown }>(
      ({ t }) => useArrivalCue(t),
      { initialProps: { t: a } },
    );
    expect(result.current).toBe(1);

    rerender({ t: null }); // cancel/error: no success cue
    expect(result.current).toBe(1);

    rerender({ t: b }); // the next real arrival still fires
    expect(result.current).toBe(2);
  });
});
