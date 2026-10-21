// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoqlEditor } from "./SoqlEditor";
import { RunButton } from "./RunButton";

vi.mock("../editor/LocalEditor", () => ({
  default: ({ value }: { value: string }) => <textarea aria-label="SOQL test / SOQL 测试" value={value} readOnly />,
}));
vi.mock("../editor/monaco-soql", () => ({ configureMonaco: vi.fn(), registerSoqlFormatter: vi.fn() }));
vi.mock("../editor/soqlSubqueryHighlight", () => ({ applySubqueryDecorations: vi.fn() }));
vi.mock("../editor/monaco-retrigger", () => ({ retriggerSuggestOnEdit: vi.fn() }));
vi.mock("../editor/monaco-reveal", () => ({ useMonacoReveal: () => ({ flushPending: vi.fn() }) }));
vi.mock("../editor/monaco-contextmenu", () => ({ trimContextMenu: vi.fn() }));
vi.mock("../ipc/soql", () => ({ soqlDiagnostics: vi.fn() }));
vi.mock("../theme", () => ({ useTheme: () => ({ theme: "dark", scheme: "default" }), monacoTheme: () => "vs-dark" }));
vi.mock("../org", () => ({ useOrgs: () => ({ selected: "synthetic@example.invalid" }) }));
vi.mock("./TargetOrg", () => ({ TargetOrg: () => <span>synthetic@example.invalid</span> }));
vi.mock("@astryxdesign/core/Button", () => ({
  Button: ({ label, tooltip, isDisabled, onClick }: {
    label: string; tooltip: string; isDisabled: boolean; onClick: () => void;
  }) => <button title={tooltip} disabled={isDisabled} onClick={onClick}>{label}</button>,
}));

const query = "SELECT Id FROM Synthetic__c";
function props() {
  return { value: query, onChange: vi.fn(), onRun: vi.fn(), running: false,
    useToolingApi: true, onToggleToolingApi: vi.fn(), allRows: false, onToggleAllRows: vi.fn() };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe.each([
  { language: "en-US", query: "Query", all: "All rows", run: "Run", running: "Running" },
  { language: "zh-CN", query: "查询", all: "所有行", run: "运行", running: "运行中" },
])("SOQL toolbar locale / SOQL 工具栏语言: $language", (words) => {
  beforeEach(() => { vi.spyOn(navigator, "languages", "get").mockReturnValue([words.language]); });

  it("localizes controls and preserves query options / 翻译控件并保留查询选项", () => {
    const handlers = props();
    render(<SoqlEditor {...handlers} />);
    expect(screen.getByText(words.query)).toBeTruthy();
    const tooling = screen.getByRole("button", { name: "Tooling API" });
    const all = screen.getByRole("button", { name: words.all });
    expect(tooling.getAttribute("aria-pressed")).toBe("true");
    expect(all.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(tooling);
    fireEvent.click(all);
    fireEvent.click(screen.getByRole("button", { name: words.run }));
    expect(handlers.onToggleToolingApi).toHaveBeenCalledOnce();
    expect(handlers.onToggleAllRows).toHaveBeenCalledOnce();
    expect(handlers.onRun).toHaveBeenCalledOnce();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(query);
    expect(screen.getByRole("button", { name: words.run }).title).toMatch(new RegExp(`^${words.run} \\(.+\\)$`));
  });

  it("localizes the busy state and blocks another run / 翻译忙碌状态并阻止再次运行", () => {
    const handlers = props();
    render(<SoqlEditor {...handlers} running />);
    const run = screen.getByRole("button", { name: words.running }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(run.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(run);
    expect(handlers.onRun).not.toHaveBeenCalled();
  });
});

it("updates a mounted toolbar after an OS language change / 操作系统语言变化后更新已挂载工具栏", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<SoqlEditor {...props()} />);
  expect(screen.getByRole("button", { name: "All rows" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => { window.dispatchEvent(new Event("languagechange")); });
  expect(screen.getByRole("button", { name: "所有行" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: "Tooling API" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "运行" }).title).toMatch(/^运行 \(.+\)$/);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(query);
});

it("preserves explicit action labels and matches their tooltip / 保留显式操作标签并匹配提示", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  render(<RunButton onRun={vi.fn()} running={false} label="Custom / 自定义" />);
  expect(screen.getByRole("button", { name: "Custom / 自定义" }).title).toMatch(/^Custom \/ 自定义 \(.+\)$/);
});
