// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResultTable } from "../ResultTable";

// jsdom lacks ResizeObserver, which ResultTable observes on its scroll container.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// jsdom lacks pointer-capture / scrollIntoView, which Radix DropdownMenu needs
// to open and manage focus.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

/** Open a Radix DropdownMenu whose trigger contains the given text. */
function openMenu(triggerText: string) {
  const trigger = screen.getByText(triggerText);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.pointerUp(trigger, { button: 0 });
}

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

  it("flatten mode replaces count columns with rel[i].col position columns", () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Flat" }));
    expect(screen.getByText("Contacts[0].LastName")).toBeTruthy();
    expect(screen.getByText("Yin")).toBeTruthy(); // child value inline, no expansion
    fireEvent.click(screen.getByRole("button", { name: "Nested" }));
    expect(screen.queryByText("Contacts[0].LastName")).toBeNull();
  });

  it("flatten mode groups relationship columns into one visibility toggle", () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Flat" }));
    openMenu("Columns");
    // Prove the position-column header is visible before toggling the group off.
    expect(screen.getByText("Contacts[0].LastName")).toBeTruthy();
    // One group item, not one item per position column (fixture: 2 child rows ×
    // 2 child columns = 4 generated position columns collapsed into one toggle).
    expect(screen.getByText("Contacts (4 cols)")).toBeTruthy();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Contacts[0].LastName" })).toBeNull();
    fireEvent.click(screen.getByText("Contacts (4 cols)"));
    expect(screen.queryByText("Contacts[0].LastName")).toBeNull(); // header gone
  });

  it("copy uses the flattened projection regardless of view mode", async () => {
    let copiedText = "";
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: (t: string) => ((copiedText = t), Promise.resolve()) },
    });
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /copy result/i }));
    await Promise.resolve();
    expect(copiedText).toContain("Contacts[0].LastName"); // flattened header
    expect(copiedText).toContain("Yin"); // child data present even in Nested view
    vi.unstubAllGlobals();
  });

  it("renders many columns without crashing when column virtualization kicks in", () => {
    const cols = Array.from({ length: 60 }, (_, i) => `C${i}`);
    const wide = {
      columns: cols,
      rows: [cols.map((_, i) => String(i))],
      totalSize: 1,
      childTables: [],
    };
    render(<ResultTable data={wide} />);
    expect(screen.getByText("C0")).toBeTruthy();
  });

  it("advanced filter hides parent rows whose children fail the predicate", () => {
    render(
      <ResultTable
        data={data}
        initialAdvancedFilter={{
          combinator: "and",
          rules: [
            {
              field: "Contacts",
              operator: "=",
              match: { mode: "some" },
              value: {
                combinator: "and",
                rules: [{ field: "Age__c", operator: ">=", value: "10" }],
              },
            } as never,
          ],
        }}
      />
    );
    expect(screen.getByText("Acme")).toBeTruthy(); // has a contact aged 10
    expect(screen.queryByText("Globex")).toBeNull(); // no children → some=false
    expect(screen.getByText(/1 \/ 2 shown/)).toBeTruthy();
  });
});
