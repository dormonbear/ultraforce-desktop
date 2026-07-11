// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResultTable } from "../ResultTable";

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
    ["001A", "Acme", "2"],
    ["001B", "Globex", ""],
    ["001C", "Initech", "1"],
  ],
  totalSize: 3,
  childTables: [
    {
      rowIndex: 0,
      column: "Contacts",
      totalSize: 2,
      done: true,
      columns: ["LastName"],
      rows: [["Yin"], ["Zhao"]],
      children: [],
    },
    {
      rowIndex: 2,
      column: "Contacts",
      totalSize: 1,
      done: true,
      columns: ["LastName"],
      rows: [["Wang"]],
      children: [],
    },
  ],
};

/** Right-click the header cell whose label matches. */
function openHeaderMenu(label: string) {
  fireEvent.contextMenu(screen.getByText(label, { selector: "span" }));
}

describe("header context menu", () => {
  afterEach(cleanup);

  it("shows sort and copy items for plain columns, no quick filters", () => {
    render(<ResultTable data={data} />);
    openHeaderMenu("Name");
    expect(screen.getByText("Sort ascending")).toBeTruthy();
    expect(screen.getByText("Sort descending")).toBeTruthy();
    expect(screen.getByText("Clear sort")).toBeTruthy();
    expect(screen.getByText("Copy column")).toBeTruthy();
    expect(screen.queryByText("Only with child records")).toBeNull();
  });

  it("sorts via the menu items", () => {
    render(<ResultTable data={data} />);
    openHeaderMenu("Name");
    fireEvent.click(screen.getByText("Sort descending"));
    let gutter = screen.getAllByRole("row").map((r) => r.textContent);
    // Initech > Globex > Acme descending.
    expect(gutter.join("|")).toMatch(/Initech.*Globex.*Acme/);
    openHeaderMenu("Name");
    fireEvent.click(screen.getByText("Clear sort"));
    gutter = screen.getAllByRole("row").map((r) => r.textContent);
    expect(gutter.join("|")).toMatch(/Acme.*Globex.*Initech/);
  });

  it("shows the two quick-filter items on subquery columns", () => {
    render(<ResultTable data={data} />);
    openHeaderMenu("Contacts");
    expect(screen.getByText("Only with child records")).toBeTruthy();
    expect(screen.getByText("Only without child records")).toBeTruthy();
  });

  it("filters to rows with children, then clears on re-pick", () => {
    render(<ResultTable data={data} />);
    openHeaderMenu("Contacts");
    fireEvent.click(screen.getByText("Only with child records"));
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Initech")).toBeTruthy();
    expect(screen.queryByText("Globex")).toBeNull();
    expect(screen.getByText(/2 \/ 3 shown/)).toBeTruthy();

    // Picking the active item again clears the quick filter.
    openHeaderMenu("Contacts");
    fireEvent.click(screen.getByText("Only with child records"));
    expect(screen.getByText("Globex")).toBeTruthy();
    expect(screen.queryByText(/shown/)).toBeNull();
  });

  it("switching to 'without' replaces the rule", () => {
    render(<ResultTable data={data} />);
    openHeaderMenu("Contacts");
    fireEvent.click(screen.getByText("Only with child records"));
    expect(screen.queryByText("Globex")).toBeNull();

    openHeaderMenu("Contacts");
    fireEvent.click(screen.getByText("Only without child records"));
    expect(screen.getByText("Globex")).toBeTruthy();
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.queryByText("Initech")).toBeNull();
    expect(screen.getByText(/1 \/ 3 shown/)).toBeTruthy();
  });

  it("keeps user-authored filter rules across quick-rule add and remove", () => {
    render(
      <ResultTable
        data={data}
        initialAdvancedFilter={{
          combinator: "and",
          rules: [{ field: "Name", operator: "contains", value: "x" }],
        }}
      />,
    );
    // User rule alone: only Globex contains "x".
    expect(screen.getByText(/1 \/ 3 shown/)).toBeTruthy();
    expect(screen.getByText("Globex")).toBeTruthy();

    openHeaderMenu("Contacts");
    fireEvent.click(screen.getByText("Only with child records"));
    // Intersection is empty (Globex has no children) — user rule still applies.
    expect(screen.getByText(/0 \/ 3 shown/)).toBeTruthy();

    openHeaderMenu("Contacts");
    fireEvent.click(screen.getByText("Only with child records"));
    // Quick rule removed; the user rule survives untouched.
    expect(screen.getByText(/1 \/ 3 shown/)).toBeTruthy();
    expect(screen.getByText("Globex")).toBeTruthy();
  });
});
