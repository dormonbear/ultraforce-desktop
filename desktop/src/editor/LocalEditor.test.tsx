// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorProps, Monaco, OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import LocalEditor from "./LocalEditor";

const state = vi.hoisted(() => ({ props: null as EditorProps | null }));
vi.mock("./monaco-local", () => ({ initializeLocalMonaco: vi.fn(async () => {}) }));
vi.mock("@monaco-editor/react", () => ({
  default: (props: EditorProps) => {
    state.props = props;
    return <input aria-label="Owned editor / 自有编辑器" />;
  },
}));
beforeEach(() => { state.props = null; });
afterEach(cleanup);

const focusEditor: OnMount = (instance) => instance.focus();
async function finishMount() {
  const input = await screen.findByRole("textbox", { name: "Owned editor / 自有编辑器" });
  // Only focus is needed at this callback boundary. / 此回调边界仅需 focus 方法。
  const instance = { focus: () => input.focus() } as editor.IStandaloneCodeEditor;
  act(() => state.props!.onMount!(instance, {} as Monaco));
  return input;
}

it("late mount preserves keyboard focus in the tab list / 迟到挂载保留标签栏键盘焦点", async () => {
  render(<>
    <div role="tablist"><button role="tab" aria-selected="true">Owned tab / 自有标签</button></div>
    <LocalEditor onMount={focusEditor} />
  </>);
  await screen.findByRole("textbox");
  const tab = screen.getByRole("tab");
  tab.focus();
  await finishMount();
  expect(document.activeElement).toBe(tab);
});

it("late mount preserves a tab-list action's focus / 迟到挂载保留标签栏操作焦点", async () => {
  render(<>
    <div role="tablist"><button>Owned close / 自有关闭</button></div>
    <LocalEditor onMount={focusEditor} />
  </>);
  await screen.findByRole("textbox");
  const close = screen.getByRole("button");
  close.focus();
  await finishMount();
  expect(document.activeElement).toBe(close);
});

it("a normal file opener still gives the editor typing focus / 普通文件打开仍使编辑器获得输入焦点", async () => {
  render(<><button>Owned file / 自有文件</button><LocalEditor onMount={focusEditor} /></>);
  await screen.findByRole("textbox");
  screen.getByRole("button").focus();
  const input = await finishMount();
  expect(document.activeElement).toBe(input);
});

it("deferred mounting invokes the latest callback / 延迟挂载调用最新回调", async () => {
  const previous = vi.fn();
  const current = vi.fn(focusEditor);
  const view = render(<LocalEditor onMount={previous} />);
  await screen.findByRole("textbox");
  view.rerender(<LocalEditor onMount={current} />);
  await finishMount();
  expect(previous).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledOnce();
});
