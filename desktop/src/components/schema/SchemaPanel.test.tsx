// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SchemaPanel } from "./SchemaPanel";
import type { SchemaObject, SchemaObjectDetail } from "../../types";

// jsdom lacks ResizeObserver, which the resizable panes observe.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom performs no layout, so offsetWidth/offsetHeight are 0 and the virtualized
// ObjectList/FieldTable would render an empty range (@tanstack/react-virtual reads
// offsetHeight for both viewport and row sizing). Stub non-zero sizes so the
// leading rows render.
const sizeSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeAll(() => {
  sizeSpies.push(
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600),
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240),
  );
});
afterAll(() => sizeSpies.forEach((s) => s.mockRestore()));

vi.mock("../../ipc/schema", () => ({
  listSchemaObjects: vi.fn(),
  getSchemaObjectDetail: vi.fn(),
}));

// SchemaPanel subscribes to `index-progress` for reindex recovery; stub the
// Tauri event bridge (absent in jsdom) so it resolves to a no-op unsubscribe.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { getSchemaObjectDetail, listSchemaObjects } from "../../ipc/schema";

const objects: SchemaObject[] = [
  { name: "Account", label: "Account", custom: false, keyPrefix: "001" },
  { name: "Contact", label: "Contact", custom: false, keyPrefix: "003" },
];

const accountDetail: SchemaObjectDetail = {
  name: "Account",
  label: "Account",
  keyPrefix: "001",
  custom: false,
  childRelationships: [],
  recordTypes: [],
  fields: [
    {
      name: "Industry",
      label: "Industry",
      fieldType: "picklist",
      custom: false,
      nillable: true,
      referenceTo: [],
      relationshipName: null,
      picklistValues: [
        { label: "Tech", value: "Tech", active: true, defaultValue: true },
      ],
      restrictedPicklist: false,
      dependentPicklist: false,
      calculated: false,
      calculatedFormula: null,
      length: 0,
      unique: false,
      inlineHelpText: null,
    },
  ],
};

describe("SchemaPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the object list from the ipc layer", async () => {
    vi.mocked(listSchemaObjects).mockResolvedValue(objects);
    render(<SchemaPanel org="ultraforce" />);
    expect(await screen.findByText("Account")).toBeTruthy();
    expect(screen.getByText("Contact")).toBeTruthy();
    expect(listSchemaObjects).toHaveBeenCalledWith("ultraforce");
  });

  it("loads and renders field rows when an object is clicked", async () => {
    vi.mocked(listSchemaObjects).mockResolvedValue(objects);
    vi.mocked(getSchemaObjectDetail).mockResolvedValue(accountDetail);
    render(<SchemaPanel org="ultraforce" />);
    fireEvent.click(await screen.findByText("Account"));
    expect(await screen.findByText("Industry")).toBeTruthy();
    expect(getSchemaObjectDetail).toHaveBeenCalledWith("ultraforce", "Account");
  });

  it("refetches detail after an org switch instead of serving the old org's cache", async () => {
    vi.mocked(listSchemaObjects).mockResolvedValue(objects);
    vi.mocked(getSchemaObjectDetail).mockResolvedValue(accountDetail);
    const { rerender } = render(<SchemaPanel org="orgA" />);
    fireEvent.click(await screen.findByText("Account"));
    expect(await screen.findByText("Industry")).toBeTruthy();
    expect(getSchemaObjectDetail).toHaveBeenCalledWith("orgA", "Account");

    rerender(<SchemaPanel org="orgB" />);
    fireEvent.click(await screen.findByText("Account"));
    expect(await screen.findByText("Industry")).toBeTruthy();
    expect(getSchemaObjectDetail).toHaveBeenCalledWith("orgB", "Account");
    expect(getSchemaObjectDetail).toHaveBeenCalledTimes(2);
  });

  it("retries the detail fetch when the same object is re-clicked after a failure", async () => {
    vi.mocked(listSchemaObjects).mockResolvedValue(objects);
    vi.mocked(getSchemaObjectDetail)
      .mockRejectedValueOnce({ code: "io", message: "disk error" })
      .mockResolvedValueOnce(accountDetail);
    render(<SchemaPanel org="ultraforce" />);
    fireEvent.click(await screen.findByText("Account"));
    await vi.waitFor(() =>
      expect(getSchemaObjectDetail).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText("Industry")).toBeNull();

    // The detail pane header also reads "Account" now — click the list entry.
    fireEvent.click(screen.getAllByText("Account")[0]);
    expect(await screen.findByText("Industry")).toBeTruthy();
    expect(getSchemaObjectDetail).toHaveBeenCalledTimes(2);
  });

  it("shows the index hint when the org has no schema index", async () => {
    vi.mocked(listSchemaObjects).mockRejectedValue({
      code: "no-index",
      message: "No schema index for org “ultraforce”.",
    });
    render(<SchemaPanel org="ultraforce" />);
    expect(await screen.findByText(/reindex org/i)).toBeTruthy();
  });
});
