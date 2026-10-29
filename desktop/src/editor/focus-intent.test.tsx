// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useEditorFocusIntent } from "./focus-intent";

beforeEach(() => vi.spyOn(document, "hasFocus").mockReturnValue(true));
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("editor focus intent / 编辑器焦点意图", () => {
  it("allows the matching request until the user moves focus / 仅在用户移动焦点前允许匹配的请求", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    document.body.append(first, second);
    first.focus();
    const { result } = renderHook(() => useEditorFocusIntent());
    act(() => result.current.capture({ path: "/ws/a.soql" }));
    expect(result.current.allows("tab-a", "/ws/a.soql")).toBe(true);
    expect(result.current.allows("tab-b", "/ws/b.soql")).toBe(false);
    act(() => second.focus());
    expect(result.current.allows("tab-a", "/ws/a.soql")).toBe(false);
    act(() => first.focus());
    expect(result.current.allows("tab-a", "/ws/a.soql")).toBe(false);
    act(() => result.current.capture({ id: "tab-b" }));
    expect(result.current.allows("tab-b", "/ws/b.soql")).toBe(true);
    expect(result.current.allows("tab-a", "/ws/a.soql")).toBe(false);
  });

  it("permits focus after its original control is removed / 原始控件移除后仍可获取焦点", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const { result } = renderHook(() => useEditorFocusIntent());
    act(() => result.current.capture());
    act(() => button.remove());
    expect(document.activeElement).toBe(document.body);
    expect(result.current.allows("tab-a", "/ws/a.soql")).toBe(true);
  });

  it("does not claim focus while the application is inactive / 应用未激活时不获取焦点", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const { result } = renderHook(() => useEditorFocusIntent());
    act(() => result.current.capture({ id: "tab-a" }));
    vi.mocked(document.hasFocus).mockReturnValue(false);
    expect(result.current.allows("tab-a", "/ws/a.soql")).toBe(false);
  });

  it("does not reclaim focus after the application lost and regained it / 应用失去并恢复焦点后不抢占焦点", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const { result } = renderHook(() => useEditorFocusIntent());
    act(() => result.current.capture({ id: "tab-a" }));
    act(() => window.dispatchEvent(new Event("blur")));
    expect(result.current.allows("tab-a", "/ws/a.soql")).toBe(false);
  });
});
