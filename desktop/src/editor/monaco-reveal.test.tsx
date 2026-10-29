// @vitest-environment jsdom
import type { RefObject } from "react";
import type { editor } from "monaco-editor";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMonacoReveal } from "./monaco-reveal";

describe("reveal focus ownership / 跳转焦点归属", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it.each([true, false])("reveals the line and respects focus permission %s / 跳转到行并遵守焦点许可", (allowed) => {
    const instance = { revealLineInCenter: vi.fn(), setPosition: vi.fn(), focus: vi.fn() };
    const ref = { current: instance } as unknown as RefObject<editor.IStandaloneCodeEditor | null>;
    renderHook(() => useMonacoReveal(ref, { line: 12, nonce: 1 }, () => allowed));
    act(() => vi.runAllTimers());
    expect(instance.revealLineInCenter).toHaveBeenCalledWith(12);
    expect(instance.setPosition).toHaveBeenCalledWith({ lineNumber: 12, column: 1 });
    expect(instance.focus).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
});
