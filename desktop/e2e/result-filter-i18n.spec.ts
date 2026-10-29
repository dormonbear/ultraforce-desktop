import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { translate } from "../src/i18n";

const labels = {
  "en-US": { search: "Filter rows", columns: "Columns", filter: "Advanced filter", copy: "Copy result", export: "Export", combinator: "Combinator", and: "AND", add: "Add rule", field: "Field", operator: "Operator", value: "Value", remove: "Remove rule", contains: "contains", matchMode: "Match mode", some: "some", subquery: "Contacts (subquery)" },
  "zh-CN": { search: "筛选行", columns: "列", filter: "高级筛选", copy: "复制结果", export: "导出", combinator: "逻辑关系", and: "且", add: "添加规则", field: "字段", operator: "操作符", value: "值", remove: "删除规则", contains: "包含", matchMode: "匹配模式", some: "至少一个", subquery: "Contacts（子查询）" },
} as const;

for (const locale of ["en-US", "zh-CN"] as const) test.describe(locale, () => {
  test.use({ locale });
  test("localizes result filtering without changing rules / 本地化结果筛选且不改变规则", async ({ page }) => {
    await gotoApp(page);
    await page.getByText("accounts.soql", { exact: true }).first().click();
    await page.getByRole("button", { name: translate(locale === "zh-CN" ? "zh-CN" : "en", "Run"), exact: true }).click();
    const cells = page.getByRole("cell", { name: /^Account \d+$/ });
    await expect(cells).toHaveCount(12);

    const text = labels[locale];
    await expect(page.getByRole("textbox", { name: text.search })).toBeVisible();
    await expect(page.getByRole("button", { name: text.columns, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: text.copy })).toBeVisible();
    await expect(page.getByRole("button", { name: text.export, exact: true })).toBeVisible();
    await page.getByRole("button", { name: text.filter }).click();
    const builder = page.locator(".uf-querybuilder");
    await expect(builder.getByTitle(text.combinator).locator("option:checked")).toHaveText(text.and);
    await builder.getByTitle(text.add).click();
    await builder.getByTitle(text.field).selectOption("Name");
    await expect(builder.getByTitle(text.operator).locator('option[value="contains"]')).toHaveText(text.contains);
    await builder.getByTitle(text.operator).selectOption("contains");
    await builder.getByTitle(text.value).fill("Account 1");
    await expect(builder.getByTitle(text.remove)).toBeVisible();
    await expect(cells).toHaveCount(3);

    const next = locale === "en-US" ? "zh-CN" : "en-US";
    await page.evaluate((language) => {
      Object.defineProperty(navigator, "languages", { value: [language], configurable: true });
      window.dispatchEvent(new Event("languagechange"));
    }, next);
    await expect(page.getByRole("button", { name: labels[next].filter })).toBeVisible();
    await expect(builder.getByTitle(labels[next].operator)).toBeVisible();
    await expect(cells).toHaveCount(3);
  });

  test("localizes subquery match modes / 本地化子查询匹配模式", async ({ page }) => {
    await gotoApp(page, { run_soql: {
      columns: ["Name", "Contacts"], rows: [["Account 1", "1"]], totalSize: 1, done: true,
      childTables: [{ rowIndex: 0, column: "Contacts", totalSize: 1, done: true, columns: ["LastName"], rows: [["Yin"]], children: [] }],
    } });
    await page.getByText("accounts.soql", { exact: true }).first().click();
    await page.getByRole("button", { name: translate(locale === "zh-CN" ? "zh-CN" : "en", "Run"), exact: true }).click();
    await expect(page.getByRole("cell", { name: "Account 1" })).toBeVisible();
    const text = labels[locale];
    await page.getByRole("button", { name: text.filter }).click();
    const builder = page.locator(".uf-querybuilder");
    await builder.getByTitle(text.add).click();
    await expect(builder.getByTitle(text.field).locator('option[value="Contacts"]')).toHaveText(text.subquery);
    await builder.getByTitle(text.field).selectOption("Contacts");
    await expect(builder.getByTitle(text.matchMode).locator('option[value="some"]')).toHaveText(text.some);
    await builder.getByTitle(text.matchMode).selectOption("some");
    const next = locale === "en-US" ? "zh-CN" : "en-US";
    await page.evaluate((language) => {
      Object.defineProperty(navigator, "languages", { value: [language], configurable: true });
      window.dispatchEvent(new Event("languagechange"));
    }, next);
    const mode = builder.getByTitle(labels[next].matchMode);
    await expect(mode).toHaveValue("some");
    await expect(mode.locator('option[value="some"]')).toHaveText(labels[next].some);
  });
});
