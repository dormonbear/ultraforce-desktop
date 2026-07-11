// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResultTable } from "../ResultTable";

vi.mock("../../ipc/soql", () => ({
  soqlColumnLabels: vi.fn(async () => ({
    // "Id" deliberately absent from every map → falls back to the API name.
    parent: { Name: "Account Name" },
    children: {
      Contacts: { label: "Contact People", columns: { LastName: "Last Name" } },
    },
  })),
}));

// jsdom lacks ResizeObserver, which ResultTable observes on its scroll container.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// jsdom lacks pointer-capture / scrollIntoView, which Radix menus need.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const data = {
  columns: ["Id", "Name", "Contacts"],
  rows: [
    ["001B", "Beta", "1"],
    ["001A", "Alpha", ""],
  ],
  totalSize: 2,
  childTables: [
    {
      rowIndex: 0,
      column: "Contacts",
      totalSize: 1,
      done: true,
      columns: ["LastName"],
      rows: [["Yin"]],
      children: [],
    },
  ],
};

const QUERY = "SELECT Id, Name, (SELECT LastName FROM Contacts) FROM Account";

describe("api name / label toggle", () => {
  afterEach(cleanup);

  it("swaps header text to labels and back, falling back for missing entries", async () => {
    render(<ResultTable data={data} query={QUERY} />);
    expect(screen.getByText("Name")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show field labels" }));
    expect(await screen.findByText("Account Name")).toBeTruthy();
    // Relationship column header resolves via the children map.
    expect(screen.getByText("Contact People")).toBeTruthy();
    expect(screen.queryByText("Contacts")).toBeNull();
    // In neither map → API name stays.
    expect(screen.getByText("Id")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show field labels" }));
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Contacts")).toBeTruthy();
    expect(screen.queryByText("Account Name")).toBeNull();
  });

  it("swaps detail panel field names and relationship title", async () => {
    render(<ResultTable data={data} query={QUERY} />);
    fireEvent.click(screen.getByText("Beta")); // open panel (row with children)
    expect(screen.getByText("Contacts (1)")).toBeTruthy();
    expect(screen.getByText("LastName", { selector: "td" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show field labels" }));
    expect(await screen.findByText("Contact People (1)")).toBeTruthy();
    expect(screen.getByText("Last Name", { selector: "td" })).toBeTruthy();
    expect(screen.queryByText("Contacts (1)")).toBeNull();
  });

  it("keeps column ids API-based: sorting still works in label mode", async () => {
    render(<ResultTable data={data} query={QUERY} />);
    fireEvent.click(screen.getByRole("button", { name: "Show field labels" }));
    const header = await screen.findByText("Account Name");
    fireEvent.click(header); // sort ascending by the Name column
    const rows = screen.getAllByRole("row").map((r) => r.textContent);
    expect(rows.join("|")).toMatch(/Alpha.*Beta/);
  });

  it("resolves flattened child column headers in flat mode", async () => {
    render(<ResultTable data={data} query={QUERY} />);
    fireEvent.click(screen.getByRole("button", { name: "Flat" }));
    expect(screen.getByText("Contacts[0].LastName")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show field labels" }));
    expect(await screen.findByText("Contact People[0].Last Name")).toBeTruthy();
    expect(screen.queryByText("Contacts[0].LastName")).toBeNull();
  });

  it("hides the toggle when no query is provided", () => {
    render(<ResultTable data={data} />);
    expect(
      screen.queryByRole("button", { name: "Show field labels" }),
    ).toBeNull();
  });
});
