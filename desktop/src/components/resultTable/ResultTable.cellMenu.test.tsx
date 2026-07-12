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
// jsdom lacks pointer-capture / scrollIntoView, which Radix menus need.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const data = {
  columns: ["Id", "Name", "Contacts"],
  rows: [
    ["001A", "Acme", "1"],
    ["001B", "Globex", ""],
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

function stubClipboard() {
  const copied: string[] = [];
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: {
      writeText: (t: string) => (copied.push(t), Promise.resolve()),
    },
  });
  return copied;
}

describe("cell context menu", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("right-click shows 'Copy value' and copies the cell text", async () => {
    const copied = stubClipboard();
    render(<ResultTable data={data} />);
    fireEvent.contextMenu(screen.getByText("Acme"));
    fireEvent.click(screen.getByText("Copy value"));
    await Promise.resolve();
    expect(copied).toEqual(["Acme"]);
  });

  it("left-click selects the row without writing the clipboard", () => {
    const copied = stubClipboard();
    render(<ResultTable data={data} />);
    const row = screen.getByText("Acme").closest("tr")!;
    fireEvent.click(screen.getByText("Acme"));
    expect(copied).toEqual([]);
    expect(row.classList.contains("fjord-row-selected")).toBe(true);
  });

  it("cells no longer carry a hover tooltip", () => {
    render(<ResultTable data={data} />);
    expect(screen.getByText("Acme").getAttribute("title")).toBeNull();
  });
});
