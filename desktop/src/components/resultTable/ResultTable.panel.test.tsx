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
    ["001C", "Initech", "1"],
  ],
  totalSize: 3,
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
    {
      rowIndex: 2,
      column: "Contacts",
      totalSize: 1,
      done: true,
      columns: ["LastName", "Age__c"],
      rows: [["Wang", 42]],
    },
  ],
};

describe("subquery detail panel", () => {
  afterEach(cleanup);

  it("opens the panel with child content and highlights the row on click", () => {
    render(<ResultTable data={data} />);
    const row = screen.getByText("Acme").closest("tr")!;
    expect(row.classList.contains("bg-accent")).toBe(false);
    expect(screen.queryByText("Yin")).toBeNull();

    fireEvent.click(screen.getByText("Acme"));

    // ChildGrid header (column + totalSize) + a child cell value show in panel.
    expect(screen.getByText("Contacts (250)")).toBeTruthy();
    expect(screen.getByText("Yin")).toBeTruthy();
    expect(row.classList.contains("bg-accent")).toBe(true);
  });

  it("closes the panel when the same row is clicked again", () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByText("Acme"));
    expect(screen.getByText("Yin")).toBeTruthy();
    fireEvent.click(screen.getByText("Acme"));
    expect(screen.queryByText("Yin")).toBeNull();
  });

  it("switches panel content when a different row is clicked", () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByText("Acme"));
    expect(screen.getByText("Yin")).toBeTruthy();
    fireEvent.click(screen.getByText("Initech"));
    expect(screen.getByText("Wang")).toBeTruthy();
    expect(screen.queryByText("Yin")).toBeNull();
  });

  it("closes on Esc and on the close button", () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByText("Acme"));
    expect(screen.getByText("Yin")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("Yin")).toBeNull();

    fireEvent.click(screen.getByText("Acme"));
    expect(screen.getByText("Yin")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close detail panel" }));
    expect(screen.queryByText("Yin")).toBeNull();
  });

  it("renders a muted dash for childless rows and 'No child records' when selected", () => {
    render(<ResultTable data={data} />);
    // Only Globex has a child column with no children → exactly one em dash.
    expect(screen.getByText("—")).toBeTruthy();
    fireEvent.click(screen.getByText("Globex"));
    expect(screen.getByText("No child records")).toBeTruthy();
  });

  it("closes the panel and flattens columns when switching to Flat mode", () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByText("Acme"));
    expect(screen.getByText("Contacts (250)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Flat" }));
    expect(screen.queryByText("Contacts (250)")).toBeNull(); // panel closed
    expect(screen.getByText("Contacts[0].LastName")).toBeTruthy();
    expect(screen.getByText("Yin")).toBeTruthy(); // child value inline

    fireEvent.click(screen.getByRole("button", { name: "Nested" }));
    expect(screen.queryByText("Contacts[0].LastName")).toBeNull();
  });

  it("flatten mode groups relationship columns into one visibility toggle", () => {
    render(<ResultTable data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Flat" }));
    openMenu("Columns");
    expect(screen.getByText("Contacts[0].LastName")).toBeTruthy();
    // 2 child rows × 2 child columns = 4 position columns collapsed into one toggle.
    expect(screen.getByText("Contacts (4 cols)")).toBeTruthy();
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Contacts[0].LastName" }),
    ).toBeNull();
    fireEvent.click(screen.getByText("Contacts (4 cols)"));
    expect(screen.queryByText("Contacts[0].LastName")).toBeNull();
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
      />,
    );
    expect(screen.getByText("Acme")).toBeTruthy(); // has a contact aged 10
    expect(screen.getByText("Initech")).toBeTruthy(); // has a contact aged 42
    expect(screen.queryByText("Globex")).toBeNull(); // no children → some=false
    expect(screen.getByText(/2 \/ 3 shown/)).toBeTruthy();
  });
});
