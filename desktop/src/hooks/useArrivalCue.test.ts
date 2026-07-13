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

  it("does NOT fire for a token that already existed at mount (remount)", () => {
    // A SOQL tab switch re-mounts the view over an existing result; that must
    // not replay the arrival scan.
    const existing = { id: 1 };
    const { result, rerender } = renderHook<number, { t: unknown }>(
      ({ t }) => useArrivalCue(t),
      { initialProps: { t: existing } },
    );
    expect(result.current).toBe(0);
    rerender({ t: existing });
    expect(result.current).toBe(0);
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
      { initialProps: { t: null } },
    );
    expect(result.current).toBe(0);

    rerender({ t: a }); // first post-mount arrival fires
    expect(result.current).toBe(1);

    rerender({ t: null }); // cancel/error: no success cue
    expect(result.current).toBe(1);

    rerender({ t: b }); // the next real arrival still fires
    expect(result.current).toBe(2);
  });

  it("with requirePrevToken, suppresses the first null → token adoption", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const { result, rerender } = renderHook<number, { t: unknown }>(
      ({ t }) => useArrivalCue(t, true),
      { initialProps: { t: null } },
    );

    rerender({ t: a }); // first adoption: no fire (no previous token)
    expect(result.current).toBe(0);

    rerender({ t: b }); // real edge after adoption: fires once
    expect(result.current).toBe(1);
  });
});
