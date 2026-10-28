// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LogView } from "./LogView";
import { SourceDialog } from "./SourceDialog";
import { clearApexSourceCache } from "./useApexSource";

const effects = vi.hoisted(() => ({ copy: vi.fn(), source: vi.fn() }));
vi.mock("../clipboard", () => ({ copyText: effects.copy }));
vi.mock("../ipc/apex", () => ({ fetchApexSource: effects.source }));
vi.mock("../org", () => ({ useOrgs: () => ({ selected: "synthetic-org" }) }));
vi.mock("../theme", () => ({ useTheme: () => ({ theme: "dark", scheme: "default" }), monacoTheme: () => "vs-dark" }));
vi.mock("../editor/LocalEditor", () => ({ default: ({ value }: { value: string }) => <pre>{value}</pre> }));
vi.mock("../editor/monaco-apex", () => ({ configureMonacoApex: vi.fn() }));
vi.mock("./motion/MotionDialog", () => ({
  MotionDialog: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null,
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    isScrolling: false,
    getTotalSize: () => count * 18,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 18 })),
  }),
}));

const raw = "RAW_{line}_$&\n16:00:00.0 (30)|USER_DEBUG|[8]|DEBUG|hello\n16:00:00.0 (40)|METHOD_EXIT|[9]|RawClass.run";
const source = { name: "RAW_{line}_$&", kind: "ApexClass", body: "public class RawClass { /* RAW_{line}_$& */ }" };
const target = { className: source.name, line: 8 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  clearApexSourceCache();
  effects.copy.mockReset().mockResolvedValue(undefined);
  effects.source.mockReset().mockResolvedValue(source);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const locale of ["en-US", "zh-CN"] as const) {
  const labels = locale === "zh-CN" ? {
    filter: "筛选日志", placeholder: "筛选日志…", debug: "仅调试", highlight: "高亮", copy: "复制日志",
    copied: "日志已复制", empty: "没有匹配的行", fetching: "正在获取源码…", line: "第 8 行", close: "关闭",
  } : {
    filter: "Filter log", placeholder: "filter log…", debug: "Debug Only", highlight: "Highlight", copy: "Copy log",
    copied: "Log copied", empty: "No matching lines", fetching: "Fetching source…", line: "line 8", close: "Close",
  };

  it(`localizes log controls and copies the unmodified log / 本地化日志控件并复制原始日志: ${locale}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    const { container } = render(<LogView raw={raw} />);
    const filter = screen.getByRole("textbox", { name: labels.filter });
    expect(filter.getAttribute("placeholder")).toBe(labels.placeholder);
    expect(screen.getByRole("checkbox", { name: labels.highlight })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: labels.debug }));
    expect(container.textContent).toContain("hello");
    expect(container.textContent).not.toContain("METHOD_EXIT");
    fireEvent.change(filter, { target: { value: "missing" } });
    expect(screen.getByText(labels.empty)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.copy }));
    expect(effects.copy).toHaveBeenCalledExactlyOnceWith(raw, labels.copied);
  });

  it(`localizes source loading and line labels without changing source data / 本地化源码加载及行号而不改变源码数据: ${locale}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
    const pending = deferred<typeof source>(); effects.source.mockReturnValueOnce(pending.promise);
    const onClose = vi.fn();
    render(<SourceDialog target={target} onClose={onClose} />);
    expect(screen.getByText(labels.fetching)).toBeTruthy();
    expect(screen.getByRole("heading").textContent).toBe(`${source.name} · ${labels.line}`);
    await act(async () => pending.resolve(source));
    expect(screen.getByRole("heading").textContent).toBe(`${source.name} · ApexClass · ${labels.line}`);
    expect(screen.getByText(source.body)).toBeTruthy();
    expect(effects.source).toHaveBeenCalledExactlyOnceWith(source.name, "synthetic-org");
    fireEvent.click(screen.getByRole("button", { name: labels.close }));
    expect(onClose).toHaveBeenCalledOnce();
  });
}

it("updates mounted log controls while retaining filtering and copying / 更新已挂载日志控件并保留筛选及复制", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<LogView raw={raw} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Filter log" }), { target: { value: "missing" } });
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect((screen.getByRole("textbox", { name: "筛选日志" }) as HTMLInputElement).value).toBe("missing");
  expect(screen.getByText("没有匹配的行")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "复制日志" }));
  expect(effects.copy).toHaveBeenCalledExactlyOnceWith(raw, "日志已复制");
});

it("updates the mounted source title without refetching source / 更新已挂载源码标题而不重新获取源码", async () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<SourceDialog target={target} onClose={vi.fn()} />);
  await act(async () => {});
  expect(screen.getByRole("heading").textContent).toContain("line 8");
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByRole("heading").textContent).toBe(`${source.name} · ApexClass · 第 8 行`);
  expect(screen.getByText(source.body)).toBeTruthy();
  expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  expect(effects.source).toHaveBeenCalledTimes(1);
});

it("keeps backend source errors literal across locale changes / 切换语言时保留后端源码错误原文", async () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  effects.source.mockRejectedValueOnce(new Error("RAW_ERROR {line}$&"));
  render(<SourceDialog target={target} onClose={vi.fn()} />);
  await act(async () => {});
  expect(screen.getByText("RAW_ERROR {line}$&")).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByText("RAW_ERROR {line}$&")).toBeTruthy();
  expect(effects.source).toHaveBeenCalledTimes(1);
});
