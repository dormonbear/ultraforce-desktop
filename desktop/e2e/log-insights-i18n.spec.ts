import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`log insights locale / 日志洞察语言: ${locale}`, () => {
    test.use({ locale });
    for (const populated of [false, true]) {
      test(`localizes ${populated ? "populated" : "empty"} insights / 本地化${populated ? "有数据" : "空"}洞察`, async ({ page }) => {
        const zh = locale === "zh-CN";
        await gotoApp(page, { get_log: {
          raw: "Synthetic log / 合成日志", apiVersion: "60.0",
          units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: populated
            ? [{ kind: "EXCEPTION_THROWN", message: "Synthetic {count} error" }] : [] }],
        } });
        await page.getByRole("button", { name: zh ? "日志" : "Logs", exact: true }).click();
        await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
        await page.getByRole("radio", { name: /^(Insights|洞察)$/i }).click();
        if (populated) {
          await expect(page.getByText(zh ? /抛出异常：Synthetic \{count\} error/ : /Exception thrown: Synthetic \{count\} error/)).toBeVisible();
          await expect(page.getByText(zh ? "修复建议：" : "Fix:")).toBeVisible();
          await expect(page.getByRole("button", { name: zh ? "查看原始日志 →" : "View raw →" })).toBeVisible();
        } else await expect(page.getByText(zh ? "未发现问题" : "No issues detected")).toBeVisible();
        await page.evaluate(language => {
          Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
          window.dispatchEvent(new Event("languagechange"));
        }, zh ? "en-US" : "zh-CN");
        if (populated) {
          await expect(page.getByText(zh ? /Exception thrown: Synthetic \{count\} error/ : /抛出异常：Synthetic \{count\} error/)).toBeVisible();
          await page.getByRole("button", { name: zh ? "View raw →" : "查看原始日志 →" }).click();
          await expect(page.getByRole("radio", { name: /^(Raw|原始)$/i, checked: true })).toBeVisible();
          await expect(page.getByText("Synthetic log / 合成日志")).toBeVisible();
        } else await expect(page.getByText(zh ? "No issues detected" : "未发现问题")).toBeVisible();
      });
    }
  });
}
