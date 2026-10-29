import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { translate } from "../src/i18n";

for (const locale of ["en-US", "zh-CN"] as const) test.describe(locale, () => {
  test.use({ locale });
  test("advertised operators filter query results / 界面提供的操作符筛选查询结果", async ({ page }) => {
    await gotoApp(page);
    await page.getByText("accounts.soql", { exact: true }).first().click();
    const language = locale === "zh-CN" ? "zh-CN" : "en";
    await page.getByRole("button", { name: translate(language, "Run"), exact: true }).click();
    const cells = page.getByRole("cell", { name: /^Account \d+$/ });
    await expect(cells).toHaveCount(12);
    await page.getByRole("button", { name: /^(Advanced filter|高级筛选)$/ }).click();
    const builder = page.locator(".uf-querybuilder");
    await builder.getByTitle(/^(Add rule|添加规则)$/).click();
    await builder.locator("select.rule-fields").selectOption("Name");

    for (const [operator, value, count] of [
      ["in", "Account 1, Account 3", 2],
      ["notIn", "Account 1, Account 3", 10],
      ["doesNotBeginWith", "Account 1", 9],
      ["doesNotEndWith", "1", 10],
    ] as const) {
      await builder.locator("select.rule-operators").selectOption(operator);
      await builder.locator("input.rule-value").fill(value);
      await expect(cells).toHaveCount(count);
    }
  });

  test("switching to a child field keeps the result view usable / 切换子表字段时结果界面保持可用", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await gotoApp(page, { run_soql: {
      columns: ["Name", "Contacts"], rows: [["Account 1", "1"], ["Account 2", "0"]], totalSize: 2, done: true,
      childTables: [{ rowIndex: 0, column: "Contacts", totalSize: 1, done: true, columns: ["LastName"], rows: [["Yin"]], children: [] }],
    } });
    await page.getByText("accounts.soql", { exact: true }).first().click();
    const language = locale === "zh-CN" ? "zh-CN" : "en";
    await page.getByRole("button", { name: translate(language, "Run"), exact: true }).click();
    const cells = page.getByRole("cell", { name: /^Account [12]$/ });
    await expect(cells).toHaveCount(2);
    await page.getByRole("button", { name: /^(Advanced filter|高级筛选)$/ }).click();
    const builder = page.locator(".uf-querybuilder");
    await builder.getByTitle(/^(Add rule|添加规则)$/).click();
    await builder.locator("select.rule-fields").selectOption("Contacts");
    await expect(builder).toBeVisible();
    await expect(cells).toHaveCount(2);
    const mode = builder.getByTitle(/^(Match mode|匹配模式)$/);
    await expect(mode).toBeVisible();
    await mode.selectOption("some");
    await builder.getByTitle(/^(Add rule|添加规则)$/).last().click();
    await builder.locator("select.rule-fields").last().selectOption("LastName");
    await builder.locator("select.rule-operators").last().selectOption("=");
    await builder.locator("input.rule-value").last().fill("Yin");
    await expect(cells).toHaveCount(1);
    await expect(page.getByRole("cell", { name: "Account 1" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
