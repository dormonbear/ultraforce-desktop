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

const data = {
  columns: ["Id", "Name", "Contacts"],
  rows: [
    ["001A", "Acme", "2"],
    ["001B", "Globex", ""],
  ],
  totalSize: 2,
  childTables: [
    {
      rowIndex: 0,
      column: "Contacts",
      totalSize: 250,
      done: false,
      columns: ["LastName", "Age__c"],
      rows: [
        ["Yin", 9],
        ["Zhao", 10],
      ],
    },
  ],
};

describe("expandable subquery cells", () => {
  afterEach(cleanup);

  it("expands a child grid on count-cell click and shows a truncation hint", () => {
    render(<ResultTable data={data} />);
    expect(screen.queryByText("Yin")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /expand Contacts/i }));
    expect(screen.getByText("Yin")).toBeTruthy();
    expect(screen.getByText("Zhao")).toBeTruthy();
    // done=false → truncation hint with totalSize (red-team #6)
    expect(screen.getByText(/2 of 250/)).toBeTruthy();
    // collapse again
    fireEvent.click(screen.getByRole("button", { name: /collapse Contacts/i }));
    expect(screen.queryByText("Yin")).toBeNull();
  });

  it("renders no expander for rows without child entries", () => {
    render(<ResultTable data={data} />);
    expect(screen.getAllByRole("button", { name: /expand Contacts/i })).toHaveLength(1);
  });
});
