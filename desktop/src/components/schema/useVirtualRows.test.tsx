// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVirtualRows } from "./useVirtualRows";

let rowHeight = 40;
let current: ReturnType<typeof useVirtualRows>;
const items = Array.from({ length: 30 }, (_, i) => ({ name: `Field${i}` }));
class ControlledObserver {
  static all: ControlledObserver[] = [];
  targets = new Set<Element>();
  constructor(public callback: ResizeObserverCallback) { ControlledObserver.all.push(this); }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
}
function Harness() {
  current = useVirtualRows(items, null, 44);
  return <div ref={current.viewportRef}>
    {current.rowVirtualizer.getVirtualItems().map((row) => <button key={row.key}
      data-index={row.index} ref={current.rowVirtualizer.measureElement}>{items[row.index].name}</button>)}
  </div>;
}
function emitRows() {
  act(() => {
    for (const observer of ControlledObserver.all) {
      const entries = [...observer.targets].filter((target) => target.hasAttribute("data-index"))
        .map((target) => ({ target, borderBoxSize: [{ inlineSize: 600, blockSize: rowHeight }] }) as unknown as ResizeObserverEntry);
      if (entries.length) observer.callback(entries, observer as unknown as ResizeObserver);
    }
  });
}
beforeEach(() => {
  rowHeight = 40;
  ControlledObserver.all = [];
  vi.stubGlobal("ResizeObserver", ControlledObserver);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-index") ? rowHeight : 200;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("hidden row notifications preserve measured heights / 隐藏行通知保留已测高度", () => {
  render(<Harness />);
  expect(current.rowVirtualizer.itemSizeCache.get(0)).toBe(40);
  rowHeight = 0;
  emitRows();
  expect(current.rowVirtualizer.itemSizeCache.get(0)).toBe(40);
});

it("visible row resizes still update the actual virtualizer / 可见行尺寸变化仍更新真实虚拟列表", () => {
  render(<Harness />);
  expect(current.rowVirtualizer.itemSizeCache.get(0)).toBe(40);
  rowHeight = 57;
  emitRows();
  expect(current.rowVirtualizer.itemSizeCache.get(0)).toBe(57);
});

it("hidden first mounts retain estimates until rows can be measured / 首次隐藏挂载保留估算直至行可测量", () => {
  rowHeight = 0;
  render(<Harness />);
  expect(current.rowVirtualizer.getTotalSize()).toBe(items.length * 44);
  rowHeight = 40;
  emitRows();
  expect(current.rowVirtualizer.itemSizeCache.get(0)).toBe(40);
});
