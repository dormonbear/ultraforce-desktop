// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Component, StrictMode, type PropsWithChildren } from "react";
import { ReferencesSection } from "./ReferencesSection";
import type { FieldDependencies, SchemaField } from "../../types";

vi.mock("../../ipc/schema", () => ({
  getFieldDependencies: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { getFieldDependencies } from "../../ipc/schema";
import { toast } from "sonner";

const field = (name: string): SchemaField => ({
  name,
  label: name,
  fieldType: "text",
  custom: true,
  nillable: true,
  referenceTo: [],
  relationshipName: null,
  picklistValues: [],
  restrictedPicklist: false,
  dependentPicklist: false,
  calculated: false,
  calculatedFormula: null,
  length: 0,
  unique: false,
  inlineHelpText: null,
});

const supported: FieldDependencies = {
  supported: true,
  fetchedAt: Date.now() - 60_000,
  items: [
    { componentType: "Layout", componentName: "Account Layout", componentId: "1" },
    { componentType: "Layout", componentName: "Sales Layout", componentId: "2" },
    { componentType: "ApexClass", componentName: "AccountService", componentId: "3" },
  ],
};

class CapabilityBoundary extends Component<PropsWithChildren, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div role="alert">{this.state.error}</div> : this.props.children; }
}

describe("ReferencesSection", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("sends one request per expansion and reuses cached results / 展开仅请求一次并复用缓存结果 (StrictMode: %s)", async (strict) => {
    let resolve!: (value: FieldDependencies) => void;
    vi.mocked(getFieldDependencies).mockReturnValue(new Promise<FieldDependencies>((done) => { resolve = done; }));
    const view = <ReferencesSection org="synthetic@example.invalid" object="Account" field={field("Synthetic__c")} />;
    render(strict ? <StrictMode>{view}</StrictMode> : view);
    const toggle = screen.getByRole("button", { name: "Where is this used?" });
    expect(getFieldDependencies).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(getFieldDependencies).toHaveBeenCalledExactlyOnceWith("synthetic@example.invalid", "Account", "Synthetic__c", false);
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(getFieldDependencies).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(supported); });
    expect(screen.getByText("AccountService")).toBeTruthy();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(getFieldDependencies).toHaveBeenCalledTimes(1);
  });

  it("ignores a late failure after unmount / 卸载后忽略迟到的失败", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(getFieldDependencies).mockReturnValue(new Promise<FieldDependencies>((_resolve, fail) => { reject = fail; }));
    const { unmount } = render(<ReferencesSection org="synthetic@example.invalid" object="Account" field={field("Synthetic__c")} />);
    fireEvent.click(screen.getByRole("button", { name: "Where is this used?" }));
    unmount();
    await act(async () => { reject(new Error("Synthetic / 合成")); });
    expect(toast.error).not.toHaveBeenCalled();
  });

  describe.each([
    { language: "en-US", title: "Where is this used?", loading: "Loading…", refresh: "Refresh references", retry: "Retry",
      failed: "Couldn’t load references.", prefix: "References: ", empty: "No references found.",
      unsupported: "Standard fields aren’t tracked by the Dependency API.", disclaimer: "Powered by the beta Dependency API",
      minute: "fetched 1 minute ago", now: "fetched just now", hours: "fetched 2 hours ago", days: "fetched 3 days ago" },
    { language: "zh-CN", title: "此字段用于何处？", loading: "正在加载…", refresh: "刷新引用", retry: "重试",
      failed: "无法加载引用。", prefix: "引用：", empty: "未找到引用。",
      unsupported: "Dependency API 不跟踪标准字段。", disclaimer: "由测试版 Dependency API 提供支持",
      minute: "1分钟前获取", now: "刚刚获取", hours: "2小时前获取", days: "3天前获取" },
  ])("reference locale / 引用语言: $language", (words) => {
    it.each([
      { label: "now", age: 0, en: "fetched just now", zh: "刚刚获取" },
      { label: "minute", age: 60_000, en: "fetched 1 minute ago", zh: "1分钟前获取" },
      { label: "minutes", age: 120_000, en: "fetched 2 minutes ago", zh: "2分钟前获取" },
      { label: "hour", age: 3_600_000, en: "fetched 1 hour ago", zh: "1小时前获取" },
      { label: "hours", age: 7_200_000, en: "fetched 2 hours ago", zh: "2小时前获取" },
      { label: "day", age: 86_400_000, en: "fetched 1 day ago", zh: "1天前获取" },
      { label: "days", age: 259_200_000, en: "fetched 3 days ago", zh: "3天前获取" },
    ])("formats age without native RelativeTimeFormat / 无原生相对时间格式化 API 时显示时间: $label", async (age) => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue([words.language]);
      vi.stubGlobal("Intl", Object.create(Intl, { RelativeTimeFormat: { value: undefined } }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(getFieldDependencies).mockResolvedValue({ ...supported, fetchedAt: Date.now() - age.age });
      render(<CapabilityBoundary><ReferencesSection org="synthetic@example.invalid" object="Account" field={field("Synthetic__c")} /></CapabilityBoundary>);
      fireEvent.click(screen.getByRole("button", { name: words.title }));
      await act(async () => {});
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText(words.language === "zh-CN" ? age.zh : age.en)).toBeTruthy();
    });

    function renderLocalized() {
      vi.spyOn(navigator, "languages", "get").mockReturnValue([words.language]);
      return render(<ReferencesSection org="synthetic@example.invalid" object="Account" field={field("Synthetic__c")} />);
    }

    it("localizes loading, controls and age while preserving metadata / 翻译加载、控件及时间并保留元数据", async () => {
      let resolve!: (value: FieldDependencies) => void;
      vi.mocked(getFieldDependencies).mockReturnValue(new Promise<FieldDependencies>((done) => { resolve = done; }));
      renderLocalized();
      fireEvent.click(screen.getByRole("button", { name: words.title }));
      expect(screen.getByText(words.loading)).toBeTruthy();
      await act(async () => { resolve({ ...supported, fetchedAt: Date.now() - 60_000 }); });
      expect(screen.getByText("AccountService")).toBeTruthy();
      expect(screen.getByText("Layout")).toBeTruthy();
      expect(screen.getByRole("button", { name: words.refresh })).toBeTruthy();
      expect(screen.getByText(words.minute)).toBeTruthy();
      expect(screen.getByText(words.disclaimer, { exact: false })).toBeTruthy();
      expect(getFieldDependencies).toHaveBeenCalledExactlyOnceWith("synthetic@example.invalid", "Account", "Synthetic__c", false);
    });

    it("localizes failure, retry and unsupported feedback / 翻译失败、重试及不支持提示", async () => {
      vi.mocked(getFieldDependencies)
        .mockRejectedValueOnce({ code: "io", message: "Synthetic failure / 合成失败" })
        .mockResolvedValueOnce({ supported: false, fetchedAt: null, items: [] });
      renderLocalized();
      fireEvent.click(screen.getByRole("button", { name: words.title }));
      await screen.findByText(words.failed);
      const message = vi.mocked(toast.error).mock.calls.at(-1)?.[0];
      expect(message).toContain(words.prefix);
      expect(message).toContain("Synthetic failure / 合成失败");
      fireEvent.click(screen.getByRole("button", { name: words.retry }));
      await screen.findByText(words.unsupported);
      expect(screen.getByText(words.disclaimer, { exact: false })).toBeTruthy();
      expect(screen.queryByRole("button", { name: words.refresh })).toBeNull();
    });

    it("localizes empty results and recent fetch feedback / 翻译空结果及最近获取提示", async () => {
      vi.mocked(getFieldDependencies).mockResolvedValue({ supported: true, fetchedAt: Date.now(), items: [] });
      renderLocalized();
      fireEvent.click(screen.getByRole("button", { name: words.title }));
      await screen.findByText(words.empty);
      expect(screen.getByText(words.now)).toBeTruthy();
    });

    it.each(["hours", "days"] as const)("localizes cached age units / 翻译缓存时间单位: %s", async (unit) => {
      const age = unit === "hours" ? 2 * 3_600_000 : 3 * 86_400_000;
      vi.mocked(getFieldDependencies).mockResolvedValue({ ...supported, fetchedAt: Date.now() - age });
      renderLocalized();
      fireEvent.click(screen.getByRole("button", { name: words.title }));
      await screen.findByText(words[unit]);
    });
  });

  it("updates mounted reference feedback without refetching / 更新已挂载引用提示且不重新获取", async () => {
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    vi.mocked(getFieldDependencies).mockResolvedValue({ ...supported, fetchedAt: Date.now() - 60_000 });
    render(<ReferencesSection org="synthetic@example.invalid" object="Account" field={field("Synthetic__c")} />);
    fireEvent.click(screen.getByRole("button", { name: "Where is this used?" }));
    await screen.findByText("fetched 1 minute ago");
    languages.mockReturnValue(["zh-CN"]);
    act(() => { window.dispatchEvent(new Event("languagechange")); });
    expect(screen.getByRole("button", { name: "此字段用于何处？" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "刷新引用" })).toBeTruthy();
    expect(screen.getByText("1分钟前获取")).toBeTruthy();
    expect(screen.getByText("AccountService")).toBeTruthy();
    expect(getFieldDependencies).toHaveBeenCalledTimes(1);
  });

  it("is collapsed by default and does not fetch until expanded", () => {
    render(<ReferencesSection org="ultraforce" object="Account" field={field("My__c")} />);
    expect(screen.getByText("Where is this used?")).toBeTruthy();
    expect(getFieldDependencies).not.toHaveBeenCalled();
  });

  it("fetches with refresh:false on first expand and groups items by type with counts", async () => {
    vi.mocked(getFieldDependencies).mockResolvedValue(supported);
    render(<ReferencesSection org="ultraforce" object="Account" field={field("My__c")} />);

    fireEvent.click(screen.getByText("Where is this used?"));

    expect(getFieldDependencies).toHaveBeenCalledWith("ultraforce", "Account", "My__c", false);

    await waitFor(() => screen.getByText("AccountService"));
    // Two groups by componentType, with counts.
    expect(screen.getByText("Layout")).toBeTruthy();
    expect(screen.getByText("ApexClass")).toBeTruthy();
    expect(screen.getByText("Account Layout")).toBeTruthy();
    expect(screen.getByText("Sales Layout")).toBeTruthy();
    // Layout group has count 2.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows a muted note for standard (unsupported) fields", async () => {
    vi.mocked(getFieldDependencies).mockResolvedValue({
      supported: false,
      fetchedAt: null,
      items: [],
    });
    render(<ReferencesSection org="ultraforce" object="Account" field={field("Name")} />);

    fireEvent.click(screen.getByText("Where is this used?"));

    await waitFor(() =>
      screen.getByText(/Standard fields aren.t tracked by the Dependency API\./),
    );
    // The beta-API disclaimer is permanent across result states, including unsupported.
    expect(screen.getByText(/Powered by the beta Dependency API/)).toBeTruthy();
  });

  it("drops a stale response when the field changes mid-flight", async () => {
    let resolveA!: (v: FieldDependencies) => void;
    vi.mocked(getFieldDependencies)
      .mockImplementationOnce(
        () => new Promise<FieldDependencies>((res) => (resolveA = res)),
      )
      .mockResolvedValueOnce({
        supported: true,
        fetchedAt: Date.now(),
        items: [
          { componentType: "Flow", componentName: "BFlow", componentId: "9" },
        ],
      });
    const { rerender } = render(
      <ReferencesSection org="ultraforce" object="Account" field={field("A__c")} />,
    );

    // Expand field A: request in flight.
    fireEvent.click(screen.getByText("Where is this used?"));
    expect(getFieldDependencies).toHaveBeenCalledWith("ultraforce", "Account", "A__c", false);

    // Switch to field B while A's request is still pending, then let A resolve.
    rerender(
      <ReferencesSection org="ultraforce" object="Account" field={field("B__c")} />,
    );
    await act(async () => {
      resolveA(supported);
    });

    // A's stale data must not leak into B's (reset, collapsed) view.
    expect(screen.queryByText("Account Layout")).toBeNull();

    // Expanding B triggers a fresh fetch with B's args and shows B's data.
    fireEvent.click(screen.getByText("Where is this used?"));
    expect(getFieldDependencies).toHaveBeenLastCalledWith(
      "ultraforce",
      "Account",
      "B__c",
      false,
    );
    await waitFor(() => screen.getByText("BFlow"));
    expect(screen.queryByText("Account Layout")).toBeNull();
  });

  it("refresh button refetches with refresh:true", async () => {
    vi.mocked(getFieldDependencies).mockResolvedValue(supported);
    render(<ReferencesSection org="ultraforce" object="Account" field={field("My__c")} />);

    fireEvent.click(screen.getByText("Where is this used?"));
    await waitFor(() => screen.getByText("AccountService"));

    fireEvent.click(screen.getByLabelText("Refresh references"));
    expect(getFieldDependencies).toHaveBeenLastCalledWith(
      "ultraforce",
      "Account",
      "My__c",
      true,
    );
  });

  it("shows a retry affordance and toasts on error", async () => {
    vi.mocked(getFieldDependencies)
      .mockRejectedValueOnce({ code: "io", message: "boom" })
      .mockResolvedValueOnce(supported);
    render(<ReferencesSection org="ultraforce" object="Account" field={field("My__c")} />);

    fireEvent.click(screen.getByText("Where is this used?"));

    await waitFor(() => screen.getByText("Retry"));
    expect(vi.mocked(toast.error)).toHaveBeenCalled();

    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => screen.getByText("AccountService"));
  });
});
