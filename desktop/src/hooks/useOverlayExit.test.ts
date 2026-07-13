// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOverlayExit } from "./useOverlayExit";

const OPTS = { exitName: "fjord-dialog-out", exitMs: 120 } as const;

/** Install a matchMedia stub so useReducedMotion resolves deterministically. */
function mockReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("useOverlayExit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays unmounted while closed", () => {
    const { result } = renderHook(() => useOverlayExit(false, OPTS));
    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);
  });

  it("mounts on open without an exit phase", () => {
    const { result, rerender } = renderHook((open: boolean) => useOverlayExit(open, OPTS), {
      initialProps: false,
    });
    act(() => rerender(true));
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);
  });

  it("keeps mounted through the exit, then unmounts on animationend", () => {
    const { result, rerender } = renderHook((open: boolean) => useOverlayExit(open, OPTS), {
      initialProps: true,
    });
    act(() => rerender(false));
    // Exit phase: still mounted, marked exiting.
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(true);

    act(() => result.current.onAnimationEnd({ animationName: "fjord-dialog-out" }));
    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);
  });

  it("ignores animationend from other animations", () => {
    const { result, rerender } = renderHook((open: boolean) => useOverlayExit(open, OPTS), {
      initialProps: true,
    });
    act(() => rerender(false));
    act(() => result.current.onAnimationEnd({ animationName: "some-child-fade" }));
    // Unrelated animation must not finalize the exit.
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(true);
  });

  it("finalizes via the safety timer if animationend never fires", () => {
    const { result, rerender } = renderHook((open: boolean) => useOverlayExit(open, OPTS), {
      initialProps: true,
    });
    act(() => rerender(false));
    expect(result.current.mounted).toBe(true);
    act(() => vi.advanceTimersByTime(OPTS.exitMs + 20));
    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);
  });

  it("cancels the exit on reopen without a flash or leaked timer", () => {
    const { result, rerender } = renderHook((open: boolean) => useOverlayExit(open, OPTS), {
      initialProps: true,
    });
    act(() => rerender(false));
    expect(result.current.exiting).toBe(true);
    // Reopen mid-exit.
    act(() => rerender(true));
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);
    // The old safety timer must not later unmount the reopened overlay.
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);
  });

  it("unmounts instantly under reduced motion (no exit phase)", () => {
    mockReducedMotion(true);
    const { result, rerender } = renderHook((open: boolean) => useOverlayExit(open, OPTS), {
      initialProps: true,
    });
    act(() => rerender(false));
    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);
  });
});
