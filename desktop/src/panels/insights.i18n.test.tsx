// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "../i18n";
import type { ExecNodeDto, StatementDto, UnitDto } from "../types";
import { InsightsView } from "./logDetail/InsightsView";
import { detectInsights } from "./insights";

const node = (label: string, children: ExecNodeDto[] = []): ExecNodeDto => ({
  label, detail: "", durNs: 1_000_000, selfNs: 500_000, startNs: 0, children, source: null,
});
const unit = (overrides: Partial<UnitDto> = {}): UnitDto => ({
  tree: [], hotspots: [], statements: [], limits: [], exceptions: [], ...overrides,
});
const statement = (kind: "soql" | "dml", rows = 2, durNs = 1_000_000): StatementDto => ({
  kind, text: kind === "soql" ? "SELECT Id FROM Synthetic__c" : "Insert Synthetic__c", rows, durNs,
});
const zh = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
  translate("zh-CN", key, values);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Localized insight detectors / 洞察检测结果本地化", () => {
  const cases: { name: string; kind: string; value: UnitDto; title: string; detail?: string; fix?: string }[] = [
    { name: "exception / 异常", kind: "exception", value: unit({ exceptions: Array.from({ length: 2 }, () => ({ kind: "EXCEPTION_THROWN", message: "Synthetic {count} error" })) }), title: "抛出异常", fix: "捕获" },
    { name: "fatal error / 致命错误", kind: "exception", value: unit({ exceptions: [{ kind: "FATAL_ERROR", message: "Synthetic fatal" }] }), title: "致命错误" },
    { name: "SOQL loop / SOQL 循环", kind: "stmt-in-loop", value: unit({ statements: Array.from({ length: 5 }, () => statement("soql")) }), title: "循环", detail: "10 行，共 5.0 ms", fix: "查询" },
    { name: "DML loop / DML 循环", kind: "stmt-in-loop", value: unit({ statements: Array.from({ length: 5 }, () => statement("dml")) }), title: "循环", fix: "批量" },
    { name: "repeated method / 重复方法", kind: "method-loop", value: unit({ hotspots: [{ signature: "Synthetic.handle()", count: 25, selfNs: 2_000_000, totalNs: 3_000_000, selfBytes: 0 }] }), title: "调用", detail: "自身耗时共 2.0 ms", fix: "循环" },
    { name: "repeated method without time / 无耗时的重复方法", kind: "method-loop", value: unit({ hotspots: [{ signature: "Synthetic.handle()", count: 25, selfNs: 0, totalNs: 0, selfBytes: 0 }] }), title: "调用", detail: "重复调用", fix: "循环" },
    { name: "loop body / 循环体", kind: "loop-body", value: unit({ tree: [node("Parent", Array.from({ length: 5 }, () => node("Child")))] }), title: "连续", detail: "循环体", fix: "循环" },
    { name: "recursion / 递归", kind: "recursion", value: unit({ tree: [node("A", [node("B", [node("A")])])] }), title: "递归", detail: "调用堆栈", fix: "防止" },
    { name: "limit / 限制", kind: "limit", value: unit({ limits: [{ namespace: "pkg", entries: [{ name: "SOQL queries", used: 100, max: 100 }] }] }), title: "限制", detail: "已使用 100 / 100", fix: "减少" },
    { name: "large and slow query / 慢速大查询", kind: "slow-query", value: unit({ statements: [statement("soql", 5000, 250_000_000)] }), title: "慢速大查询", fix: "筛选" },
    { name: "large query / 大查询", kind: "slow-query", value: unit({ statements: [statement("soql", 5000, 1)] }), title: "大查询", fix: "筛选" },
    { name: "slow query / 慢查询", kind: "slow-query", value: unit({ statements: [statement("soql", 1, 250_000_000)] }), title: "慢查询", fix: "筛选" },
    { name: "critical path / 关键路径", kind: "critical-path", value: unit({ tree: [node("Root", [node("Leaf")])] }), title: "关键路径", fix: "优化" },
  ];
  it.each(cases)("localizes $name while preserving ranking / 本地化 $name 并保留排序", ({ kind, value, title, detail, fix }) => {
    const original = detectInsights([value]);
    const localized = detectInsights([value], zh);
    expect(localized.map(({ kind: k, severity, sort }) => ({ kind: k, severity, sort })))
      .toEqual(original.map(({ kind: k, severity, sort }) => ({ kind: k, severity, sort })));
    const finding = localized.find((item) => item.kind === kind)!;
    expect(finding.title).toContain(title);
    if (detail) expect(finding.detail).toContain(detail);
    if (fix) expect(finding.fix).toContain(fix);
  });

  it("preserves raw messages and query fingerprints without interpolating their contents / 保留异常及查询原文且不解释其中的占位符", () => {
    const message = "Synthetic {count} error";
    const exception = detectInsights([unit({ exceptions: [{ kind: "EXCEPTION_THROWN", message }] })], zh)[0];
    expect(exception.title).toContain(message);
    expect(exception.detail).toBe(message);
    const query = detectInsights([unit({ statements: [statement("soql", 5000)] })], zh).find((f) => f.kind === "slow-query")!;
    expect(query.detail).toBe("SELECT Id FROM Synthetic__c");
  });
});

it.each([
  { label: "查看查询 →", target: "queries", value: unit({ statements: Array.from({ length: 5 }, () => statement("soql")) }) },
  { label: "查看限制 →", target: "limits", value: unit({ limits: [{ namespace: "", entries: [{ name: "SOQL", used: 95, max: 100 }] }] }) },
  { label: "查看时间线 →", target: "timeline", value: unit({ tree: [node("Root", [node("Leaf")])] }) },
])("keeps translated evidence navigation / 保留翻译后的证据导航: $target", ({ label, target, value }) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  const onGoto = vi.fn();
  render(<InsightsView units={[value]} onGoto={onGoto} />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(onGoto).toHaveBeenCalledWith(target);
});

it("localizes empty insights / 本地化空洞察", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  render(<InsightsView units={[]} onGoto={vi.fn()} />);
  expect(screen.getByText("未发现问题")).toBeTruthy();
});

it("switches mounted findings and preserves navigation and raw data / 切换已挂载洞察的语言并保留导航与原文", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const onGoto = vi.fn();
  render(<InsightsView units={[unit({ exceptions: [{ kind: "EXCEPTION_THROWN", message: "Synthetic {count} error" }] })]} onGoto={onGoto} />);
  expect(screen.getByRole("button", { name: "View raw →" })).toBeTruthy();
  languages.mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByText(/抛出异常/).textContent).toContain("Synthetic {count} error");
  expect(screen.getByText("Synthetic {count} error")).toBeTruthy();
  expect(screen.getByText("修复建议：")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看原始日志 →" }));
  expect(onGoto).toHaveBeenCalledWith("raw");
});
