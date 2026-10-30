import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`query-plan locale / 查询计划语言: ${locale}`, () => {
    test.use({ locale });

    for (const empty of [true, false]) {
      test(`localizes ${empty ? "empty" : "populated"} plans / 本地化${empty ? "空" : "有数据的"}查询计划`, async ({ page }) => {
        const zh = locale === "zh-CN";
        await gotoApp(page, empty ? { query_plan: { plans: [], sourceQuery: "SELECT Id FROM Account" } } : {});
        await page.getByRole("button", { name: "SOQL", exact: true }).click();
        await page.getByRole("treeitem", { name: "accounts.soql" }).click();
        await page.getByRole("button", { name: zh ? "执行计划" : "Explain", exact: true }).click();
        await expect(page.getByText(zh ? "查询计划" : "Query plan", { exact: true })).toBeVisible();
        if (empty) {
          await expect(page.getByText(zh ? "未返回查询计划" : "No plan returned")).toBeVisible();
        } else {
          await expect(page.getByRole("columnheader", { name: zh ? "成本" : "Cost" })).toBeVisible();
          await expect(page.getByText("TableScan")).toBeVisible();
          await expect(page.getByText("2.80")).toHaveClass(/text-destructive/);
          await expect(page.getByText("not selective")).toBeVisible();
        }
        await page.evaluate(language => {
          Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
          window.dispatchEvent(new Event("languagechange"));
        }, zh ? "en-US" : "zh-CN");
        await expect(page.getByText(zh ? "Query plan" : "查询计划", { exact: true })).toBeVisible();
        if (!empty) {
          await expect(page.getByRole("columnheader", { name: zh ? "Cost" : "成本" })).toBeVisible();
          await expect(page.getByText("2.80")).toHaveClass(/text-destructive/);
        }
        await page.getByRole("button", { name: zh ? "Close plan" : "关闭查询计划" }).click();
        await expect(page.getByText(zh ? "Query plan" : "查询计划", { exact: true })).toHaveCount(0);
      });
    }
  });
}
