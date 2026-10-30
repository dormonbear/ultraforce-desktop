import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";
import type { UnitDto } from "../src/types";

const unit: UnitDto = {
  tree: [], exceptions: [],
  hotspots: [{ signature: "Synthetic.handle()", selfNs: 2_000_000, totalNs: 4_000_000, selfBytes: 1024, count: 2 }],
  statements: [
    { kind: "soql", text: "SELECT Id FROM Account WHERE Name = 'A'", rows: 2, durNs: 1_000_000 },
    { kind: "soql", text: "SELECT Id FROM Account WHERE Name = 'B'", rows: 3, durNs: 2_000_000 },
    { kind: "dml", text: "Insert Account", rows: 4, durNs: 500_000 },
  ],
  limits: [{ namespace: "", entries: [{ name: "SOQL queries", used: 95, max: 100 }] }],
};

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`log analysis locale / 日志分析语言: ${locale}`, () => {
    test.use({ locale });
    for (const populated of [false, true]) {
      test(`localizes ${populated ? "populated" : "empty"} analysis / 本地化${populated ? "有数据" : "空"}分析视图`, async ({ page }) => {
        const zh = locale === "zh-CN";
        const empty: UnitDto = { tree: [], hotspots: [], statements: [], limits: [], exceptions: [] };
        await gotoApp(page, { get_log: { raw: "Synthetic log / 合成日志", apiVersion: "60.0", units: [populated ? unit : empty] } });
        await page.getByRole("button", { name: zh ? "日志" : "Logs", exact: true }).click();
        await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
        await page.getByRole("radio", { name: /^(Hotspots|热点)$/i }).click();
        if (populated) {
          await expect(page.getByRole("columnheader", { name: zh ? "方法" : "Method" })).toBeVisible();
          await expect(page.getByRole("button", { name: "Synthetic.handle()" })).toBeVisible();
        } else await expect(page.getByText(zh ? "暂无方法调用帧" : "No method frames")).toBeVisible();
        await page.getByRole("radio", { name: /^(Queries|查询)$/i }).click();
        if (populated) {
          await expect(page.getByRole("columnheader", { name: zh ? "语句" : "Statement" })).toBeVisible();
          await expect(page.getByText(zh ? /5 行/ : /5 rows/)).toBeVisible();
          await expect(page.getByText("SELECT Id FROM Account WHERE Name = 'A'")).toBeVisible();
          await expect(page.getByRole("row").filter({ hasText: "SELECT Id FROM Account" })).toHaveClass(/text-destructive/);
        } else await expect(page.getByText(zh ? "暂无 SOQL 或 DML" : "No SOQL or DML")).toBeVisible();
        await page.getByRole("radio", { name: /^(Limits|限制)$/i }).click();
        if (populated) {
          await expect(page.getByText(zh ? "（默认）" : "(default)", { exact: true })).toBeVisible();
          await expect(page.getByText("95/100 · 95%")).toHaveClass(/text-destructive/);
        } else await expect(page.getByText(zh ? "暂无限制使用数据" : "No limit usage")).toBeVisible();
        await page.evaluate(language => {
          Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
          window.dispatchEvent(new Event("languagechange"));
        }, zh ? "en-US" : "zh-CN");
        if (populated) {
          await expect(page.getByText(zh ? "(default)" : "（默认）", { exact: true })).toBeVisible();
          await expect(page.getByText("95/100 · 95%")).toHaveClass(/text-destructive/);
        } else await expect(page.getByText(zh ? "No limit usage" : "暂无限制使用数据")).toBeVisible();
      });
    }
  });
}
