// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LogDebugger } from "./LogDebugger";
import { LogoLoader } from "./LogoLoader";

const mocks = vi.hoisted(() => ({ session: vi.fn(), frames: vi.fn() }));
vi.mock("../ipc/logs", () => ({ debugSession: mocks.session, debugFramesAt: mocks.frames }));
vi.mock("../org", () => ({ useOrgs: () => ({ selected: null }) }));
vi.mock("../theme", () => ({ useTheme: () => ({ theme: "dark", scheme: "default" }), monacoTheme: () => "vs-dark" }));
vi.mock("./useApexSource", () => ({
  useApexSource: () => ({ src: { body: "RAW_SOURCE {step} $&" }, error: null }),
  revealLine: vi.fn(),
}));
vi.mock("../editor/LocalEditor", () => ({ default: ({ value }: { value: string }) => <pre>{value}</pre> }));
vi.mock("../editor/monaco-apex", () => ({ configureMonacoApex: vi.fn() }));
vi.mock("./motion/MotionDialog", () => ({
  MotionDialog: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null,
}));
vi.mock("lottie-react", () => ({
  default: (props: { "aria-label": string }) => <span role="img" aria-label={props["aria-label"]} />,
}));
vi.mock("../hooks/useReducedMotion", () => ({ useReducedMotion: () => false }));

const steps = [
  { unitIndex: 0, entryIndex: 4, source: { className: "Synthetic", line: 8 }, depth: 0, isFrameStart: true },
  { unitIndex: 0, entryIndex: 5, source: { className: "Synthetic", line: 9 }, depth: 0, isFrameStart: false },
];
const frame = {
  className: "Synthetic", line: 8, signature: "Synthetic.run({step}) $&",
  variables: [{ name: "RAW_NAME", typeName: "String", value: "RAW_VALUE {step} $&" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ steps, hasVariables: true });
  mocks.frames.mockResolvedValue([frame]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const language of ["en-US", "zh-CN"] as const) {
  const zh = language === "zh-CN";
  it(`localizes debugger controls and retains source data / 本地化调试器控件并保留源码数据: ${language}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    const onClose = vi.fn();
    render(<LogDebugger raw="SYNTHETIC_LOG" open onClose={onClose} />);
    expect(screen.getByText(zh ? "正在构建调试会话…" : "Building session…")).toBeTruthy();
    expect(await screen.findByText(zh ? "调用堆栈" : "Call stack")).toBeTruthy();
    expect(screen.getByText(zh ? "变量" : "Variables")).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "第一步" : "First" })).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "上一个函数" : "Previous function" })).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "上一步" : "Previous" })).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "跳出" : "Step out" })).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "单步进入" : "Step" })).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "单步跳过" : "Step over" })).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "下一个函数" : "Next function" })).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "最后一步" : "Last" })).toBeTruthy();
    expect(screen.getByText("RAW_SOURCE {step} $&")).toBeTruthy();
    expect(await screen.findByText("RAW_VALUE {step} $&")).toBeTruthy();
    expect(screen.getByText(zh ? "第 8 行" : "line 8")).toBeTruthy();
    expect(screen.getByText(zh ? /第 1\/2 步/ : /step 1\/2/).textContent).toContain(frame.signature);
    fireEvent.click(screen.getByRole("button", { name: zh ? "单步进入" : "Step" }));
    expect(await screen.findByText(zh ? /第 2\/2 步/ : /step 2\/2/)).toBeTruthy();
    expect(mocks.frames).toHaveBeenCalledWith("SYNTHETIC_LOG", 0, 5);
    fireEvent.click(screen.getByRole("button", { name: zh ? "关闭" : "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it(`localizes the empty debugger state / 本地化调试器空状态: ${language}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    mocks.session.mockResolvedValueOnce({ steps: [], hasVariables: false });
    render(<LogDebugger raw="SYNTHETIC_LOG" open onClose={vi.fn()} />);
    expect(await screen.findByText(zh ? "此日志单元中没有可执行的源码行。" : "No executable source lines in this log unit.")).toBeTruthy();
  });

  it(`localizes the loading animation label / 本地化加载动画标签: ${language}`, () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    render(<LogoLoader />);
    expect(screen.getByRole("img", { name: zh ? "正在加载" : "Loading" })).toBeTruthy();
  });

  it(`localizes missing variable guidance / 本地化缺少变量值时的提示: ${language}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    mocks.session.mockResolvedValueOnce({ steps, hasVariables: false });
    render(<LogDebugger raw="SYNTHETIC_LOG" open onClose={vi.fn()} />);
    expect(await screen.findByText(zh
      ? "要查看变量值，请使用 APEX_CODE=FINEST 级别捕获日志。"
      : "Variable values need a log captured at APEX_CODE=FINEST.")).toBeTruthy();
  });

  it(`localizes an empty variable frame / 本地化没有变量的调用帧: ${language}`, async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
    mocks.frames.mockResolvedValueOnce([{ ...frame, variables: [] }]);
    render(<LogDebugger raw="SYNTHETIC_LOG" open onClose={vi.fn()} />);
    expect(await screen.findByText(frame.signature)).toBeTruthy();
    expect(await screen.findByText(zh ? "当前作用域中没有变量。" : "No variables in scope.")).toBeTruthy();
  });
}

it("updates debugger labels without reloading its session / 切换调试器语言时不重新加载会话", async () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<LogDebugger raw="SYNTHETIC_LOG" open onClose={vi.fn()} />);
  expect(await screen.findByText("RAW_VALUE {step} $&")).toBeTruthy();
  const stepButton = screen.getByRole("button", { name: "Step" });
  stepButton.focus();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByText("调用堆栈")).toBeTruthy();
  expect(screen.getByRole("button", { name: "单步进入" })).toBeTruthy();
  expect(document.activeElement).toBe(stepButton);
  expect(screen.getByText("RAW_VALUE {step} $&")).toBeTruthy();
  expect(mocks.session).toHaveBeenCalledTimes(1);
});

it("keeps the pending frame subtitle free of undefined / 等待调用帧时不显示 undefined", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  mocks.frames.mockReturnValueOnce(new Promise(() => {}));
  render(<LogDebugger raw="SYNTHETIC_LOG" open onClose={vi.fn()} />);
  const subtitle = await screen.findByText(/第 1\/2 步/);
  expect(subtitle.textContent).not.toContain("undefined");
  expect(subtitle.textContent).toContain("第 — 行");
});

it("updates the loading label when the language changes / 切换语言时更新加载标签", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<LogoLoader />);
  expect(screen.getByRole("img", { name: "Loading" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByRole("img", { name: "正在加载" })).toBeTruthy();
});
