// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TabStrip } from "./TabStrip";
import type { TabBase } from "./types";

// jsdom lacks pointer-capture / scrollIntoView, which Radix menus and the
// strip's keep-active-visible effect need.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const three: TabBase[] = [
  { id: "a", title: "Alpha" },
  { id: "b", title: "Beta" },
  { id: "c", title: "Gamma" },
];

/** Minimal controlled store: onClose removes the tab, like useFileTabs. */
function Harness({ initial }: { initial: TabBase[] }) {
  const [tabs, setTabs] = useState(initial);
  const [activeId, setActiveId] = useState(initial[0]?.id ?? "");
  return (
    <TabStrip
      tabs={tabs}
      activeId={activeId}
      ariaLabel="Test tabs"
      onSelect={setActiveId}
      onClose={(id) => setTabs((prev) => prev.filter((t) => t.id !== id))}
      onAdd={() => {}}
    />
  );
}

// Titles also appear in the "All tabs" overflow dropdown — query the strip's
// tab elements by role instead of by text.
const tab = (title: string) =>
  screen
    .getAllByRole("tab", { hidden: true })
    .find((t) => t.textContent === title)!;
const tabTitles = () =>
  screen.getAllByRole("tab", { hidden: true }).map((t) => t.textContent);

describe("tab context menu", () => {
  afterEach(cleanup);

  it("middle click prevents autoscroll before closing the target tab / 中键关闭目标标签前阻止自动滚动", () => {
    render(<Harness initial={three} />);
    const target = tab("Beta");
    const down = new MouseEvent("mousedown", { button: 1, bubbles: true, cancelable: true });
    fireEvent(target, down);
    expect(down.defaultPrevented).toBe(true);
    fireEvent(target, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    expect(tabTitles()).toEqual(["Alpha", "Gamma"]);
  });

  it.each([0, 2])("preserves button %i defaults and leaves tabs open / 保留鼠标按钮默认行为且不关闭标签", (button) => {
    render(<Harness initial={three} />);
    const target = tab("Beta");
    const down = new MouseEvent("mousedown", { button, bubbles: true, cancelable: true });
    fireEvent(target, down);
    expect(down.defaultPrevented).toBe(false);
    fireEvent(target, new MouseEvent("auxclick", { button, bubbles: true, cancelable: true }));
    expect(tabTitles()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("middle click keeps the last tab without starting autoscroll / 中键保留最后标签且不启动自动滚动", () => {
    render(<Harness initial={[three[0]]} />);
    const target = tab("Alpha");
    const down = new MouseEvent("mousedown", { button: 1, bubbles: true, cancelable: true });
    fireEvent(target, down);
    expect(down.defaultPrevented).toBe(true);
    fireEvent(target, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    expect(tabTitles()).toEqual(["Alpha"]);
  });

  it("opens with the four close operations", () => {
    render(<Harness initial={three} />);
    fireEvent.contextMenu(tab("Beta"));
    expect(screen.getByText("Close")).toBeTruthy();
    expect(screen.getByText("Close Others")).toBeTruthy();
    expect(screen.getByText("Close Tabs to the Right")).toBeTruthy();
    expect(screen.getByText("Close All")).toBeTruthy();
  });

  it("Close closes only the target tab", () => {
    render(<Harness initial={three} />);
    fireEvent.contextMenu(tab("Beta"));
    fireEvent.click(screen.getByText("Close"));
    expect(tabTitles()).toEqual(["Alpha", "Gamma"]);
  });

  it("Close Others keeps only the target tab", () => {
    render(<Harness initial={three} />);
    fireEvent.contextMenu(tab("Beta"));
    fireEvent.click(screen.getByText("Close Others"));
    expect(tabTitles()).toEqual(["Beta"]);
  });

  it("Close Tabs to the Right closes only later tabs", () => {
    render(<Harness initial={three} />);
    fireEvent.contextMenu(tab("Beta"));
    fireEvent.click(screen.getByText("Close Tabs to the Right"));
    expect(tabTitles()).toEqual(["Alpha", "Beta"]);
  });

  it("disables no-op items in context", () => {
    render(<Harness initial={three} />);
    // Last tab → nothing to the right.
    fireEvent.contextMenu(tab("Gamma"));
    const right = screen
      .getByText("Close Tabs to the Right")
      .closest("[role='menuitem']");
    expect(right?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(document.body, { key: "Escape" });

    // Single tab → no others to close.
    cleanup();
    render(<Harness initial={[{ id: "solo", title: "Solo" }]} />);
    fireEvent.contextMenu(tab("Solo"));
    const others = screen.getByText("Close Others").closest("[role='menuitem']");
    expect(others?.getAttribute("aria-disabled")).toBe("true");
  });

  it("Close All empties the strip", () => {
    render(<Harness initial={three} />);
    fireEvent.contextMenu(tab("Beta"));
    fireEvent.click(screen.getByText("Close All"));
    expect(screen.queryAllByRole("tab", { hidden: true })).toHaveLength(0);
  });

  it("hides Rename when no onRename handler is given", () => {
    render(<Harness initial={three} />);
    fireEvent.contextMenu(tab("Beta"));
    expect(screen.queryByText("Rename")).toBeNull();
  });

  it("Rename commits a new name via the inline editor", async () => {
    const calls: [string, string][] = [];
    render(
      <TabStrip
        tabs={three}
        activeId="a"
        ariaLabel="Test tabs"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
        onRename={(id, title) => {
          calls.push([id, title]);
          return true;
        }}
      />,
    );
    fireEvent.contextMenu(tab("Beta"));
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByLabelText("Rename Beta") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Beta2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(calls).toEqual([["b", "Beta2"]]));
    await waitFor(() =>
      expect(screen.queryByLabelText("Rename Beta")).toBeNull(),
    );
  });

  it("keeps the editor open when a rename is rejected", async () => {
    render(
      <TabStrip
        tabs={three}
        activeId="a"
        ariaLabel="Test tabs"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
        onRename={() => false}
      />,
    );
    fireEvent.contextMenu(tab("Beta"));
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByLabelText("Rename Beta") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Rejected rename leaves the inline editor mounted for a retry.
    await waitFor(() =>
      expect(screen.getByLabelText("Rename Beta")).toBeTruthy(),
    );
  });
});
