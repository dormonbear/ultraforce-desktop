// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
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

describe("ReferencesSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
