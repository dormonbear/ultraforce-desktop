// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ObjectList } from "./ObjectList";
import { FieldTable } from "./FieldTable";
import { FieldDetail } from "./FieldDetail";
import { SchemaSearchBar } from "./SchemaSearchBar";
import type { SchemaField } from "../../types";
import { browserLocale } from "../../i18n";

beforeEach(() => {
  // Layout observers are absent in jsdom. / jsdom 不提供布局观测器。
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  { locale: "en-US", filter: "Filter objects", empty: "No matching objects" },
  { locale: "zh-CN", filter: "筛选对象", empty: "没有匹配的对象" },
])("renders object controls in $locale / 按 $locale 渲染对象控件", ({ locale, filter, empty }) => {
  vi.spyOn(navigator, "language", "get").mockReturnValue(locale);
  vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
  expect(browserLocale()).toBe(locale === "zh-CN" ? "zh-CN" : "en");
  render(<ObjectList objects={[]} selected={null} filter="" onFilterChange={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.getByPlaceholderText(filter)).toBeTruthy();
  expect(screen.getByText(empty)).toBeTruthy();
});

for (const locale of ["en-US", "zh-CN"]) {
  const zh = locale === "zh-CN";
  const setLocale = () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue(locale);
    vi.spyOn(navigator, "languages", "get").mockReturnValue([locale]);
  };

  it(`localizes empty field controls: ${locale} / 本地化空字段控件`, () => {
    setLocale();
    render(<FieldTable fields={[]} loading={false} selected={null} filter="" onFilterChange={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: zh ? "筛选字段" : "Filter fields" })).toBeTruthy();
    expect(screen.getByText(zh ? "没有匹配的字段" : "No matching fields")).toBeTruthy();
  });

  it(`localizes record type headings without changing names: ${locale} / 本地化记录类型标题并保留名称`, () => {
    setLocale();
    render(<FieldDetail org={null} objectName="Account" field={null} recordTypes={[
      { name: "Owned record name", developerName: "Owned_Type", active: true, master: true, available: true },
    ]} onClose={vi.fn()} />);
    expect(screen.getByText(zh ? "记录类型（1）" : "Record types (1)")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: zh ? "开发者名称" : "Developer name" })).toBeTruthy();
    expect(screen.getAllByText(zh ? "是" : "Yes")).toHaveLength(2);
    expect(screen.getByText("Owned record name")).toBeTruthy();
    expect(screen.getByText("Owned_Type")).toBeTruthy();
  });

  it(`localizes field detail without translating metadata: ${locale} / 本地化字段详情并保留元数据`, () => {
    setLocale();
    const field: SchemaField = {
      name: "OwnedField__c", label: "Label / owned", fieldType: "string", custom: true,
      nillable: true, referenceTo: [], relationshipName: null, picklistValues: [],
      restrictedPicklist: false, dependentPicklist: false, calculated: true,
      calculatedFormula: '"Value {count}"', length: 255, unique: false,
      inlineHelpText: "Help text {count} / owned",
    };
    render(<FieldDetail org={null} objectName="Account" field={field} recordTypes={[]} onClose={vi.fn()} />);
    expect(screen.getByText(zh ? "类型" : "Type")).toBeTruthy();
    expect(screen.getByText(zh ? "公式" : "Formula")).toBeTruthy();
    expect(screen.getByRole("button", { name: zh ? "关闭字段详情" : "Close field detail" })).toBeTruthy();
    expect(screen.getByText(field.name)).toBeTruthy();
    expect(screen.getByText(field.label)).toBeTruthy();
    expect(screen.getByText(field.inlineHelpText!)).toBeTruthy();
    expect(screen.getByText(field.calculatedFormula!)).toBeTruthy();
  });

  it(`localizes search hints and clearing: ${locale} / 本地化搜索提示及清除控件`, () => {
    setLocale();
    render(<SchemaSearchBar org={null} />);
    const input = screen.getByRole("searchbox", { name: zh ? "搜索对象结构" : "Search schema" });
    fireEvent.change(input, { target: { value: "Owned {count}" } });
    expect(screen.getByText(zh ? "请先选择组织" : "Select an org first")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: zh ? "清除搜索" : "Clear search" }));
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
  });
}

it("updates labels on language change while preserving the filter / 切换语言时更新标签并保留筛选条件", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<ObjectList objects={[]} selected={null} filter="Owned {count}" onFilterChange={vi.fn()} onSelect={vi.fn()} />);
  const input = screen.getByRole("searchbox", { name: "Filter objects" });
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(screen.getByRole("searchbox", { name: "筛选对象" })).toBe(input);
  expect((input as HTMLInputElement).value).toBe("Owned {count}");
});
