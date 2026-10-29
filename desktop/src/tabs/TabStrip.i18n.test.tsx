// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TabStrip } from "./TabStrip";
import type { TabBase } from "./types";

const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const tabs: TabBase[] = [
  { id: "a", title: "Alpha_{name}$&" },
  { id: "b", title: "Beta" },
  { id: "c", title: "Gamma" },
];

function setup() {
  const onClose = vi.fn();
  const onRename = vi.fn().mockReturnValue(true);
  render(<TabStrip tabs={tabs} activeId="a" ariaLabel="Test tabs" onSelect={vi.fn()} onClose={onClose} onAdd={vi.fn()} onRename={onRename} dirtyIds={["a"]} />);
  const tab = () => screen.getAllByRole("tab", { hidden: true }).find((element) => element.textContent === tabs[0].title)!;
  return { tab, onClose, onRename };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const locale of ["en-US", "zh-CN"] as const) {
  const labels = locale === "zh-CN" ? {
    closeTab: "关闭 Alpha_{name}$&", newTab: "新建标签", all: "所有标签", dirty: "未保存的更改",
    rename: "重命名", close: "关闭", others: "关闭其他标签", right: "关闭右侧标签", closeAll: "关闭全部标签",
  } : {
    closeTab: "Close Alpha_{name}$&", newTab: "New tab", all: "All tabs", dirty: "Unsaved changes",
    rename: "Rename", close: "Close", others: "Close Others", right: "Close Tabs to the Right", closeAll: "Close All",
  };
  it(`localizes tab controls and preserves close actions / 本地化标签控件并保留关闭操作: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    const { tab, onClose } = setup();
    expect(screen.getByRole("button", { name: labels.closeTab })).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.newTab })).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.all })).toBeTruthy();
    expect(screen.getByLabelText(labels.dirty)).toBeTruthy();
    fireEvent.contextMenu(tab());
    for (const name of [labels.rename, labels.close, labels.others, labels.right, labels.closeAll]) {
      expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("menuitem", { name: labels.others }));
    expect(onClose.mock.calls).toEqual([["b"], ["c"]]);
  });
}

it("updates an open menu without changing its actions / 更新已打开菜单且不改变操作", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const { tab, onClose } = setup();
  fireEvent.contextMenu(tab());
  expect(screen.getByRole("menuitem", { name: "Close Others" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  fireEvent.click(screen.getByRole("menuitem", { name: "关闭其他标签" }));
  expect(onClose.mock.calls).toEqual([["b"], ["c"]]);
});

it("updates the rename label while retaining its draft / 更新重命名标签并保留草稿", async () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const { tab, onRename } = setup();
  fireEvent.contextMenu(tab());
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  const input = screen.getByRole("textbox", { name: "Rename Alpha_{name}$&" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Draft_{name}$&" } });
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByRole("textbox", { name: "重命名 Alpha_{name}$&" })).toBe(input);
  expect(input.value).toBe("Draft_{name}$&");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onRename).toHaveBeenCalledExactlyOnceWith("a", "Draft_{name}$&"));
});
