import { expect, test } from "@playwright/test";
import { dropLogFile, gotoApp } from "./fixtures";

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`log detail locale / 日志详情语言: ${locale}`, () => {
    test.use({ locale });

    for (const mode of ["empty", "org", "local"] as const) {
      test(`localizes ${mode} detail and preserves state / 本地化 ${mode} 详情并保留状态`, async ({ page }) => {
        const zh = locale === "zh-CN";
        await gotoApp(page, mode === "empty" ? { list_logs: [] } : mode === "local" ? {
          parse_log: { apiVersion: "60.0", units: [{
            tree: [{ label: "METHOD_ENTRY", detail: "Fixture.run", startNs: 0, durNs: 1_000_000, selfNs: 1_000_000, children: [], source: { className: "Fixture", line: 12 } }],
            hotspots: [], statements: [], limits: [], exceptions: [],
          }] },
        } : {});
        await page.getByRole("button", { name: zh ? "日志" : "Logs", exact: true }).click();
        await expect(page.getByText(zh ? "日志详情" : "Log detail", { exact: true })).toBeVisible();
        if (mode === "empty") {
          await expect(page.getByText(zh ? "请选择日志" : "Select a log")).toBeVisible();
        } else {
          if (mode === "local") await dropLogFile(page, "Synthetic log / 合成日志");
          else await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
          await expect(page.getByText(zh ? "API 60.0 · 1 个执行单元" : "API 60.0 · 1 unit")).toBeVisible();
          if (mode === "local") await expect(page.getByText(zh ? /本地文件（无组织，源码导航已关闭）/ : /local file \(no org — source navigation off\)/)).toBeVisible();
          await page.getByRole("radio", { name: zh ? "时间线" : "Timeline", exact: true }).click();
          await expect(page.getByRole("radio", { name: zh ? "时间线" : "Timeline", checked: true })).toBeVisible();
          if (mode === "local") {
            await page.locator("canvas").click({ position: { x: 20, y: 5 } });
            await expect(page.getByText(/depth 0|深度 0/)).toBeVisible();
            await expect(page.getByRole("button", { name: /Open source|打开源码/ })).toHaveCount(0);
          }
        }
        await page.evaluate(language => {
          Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
          window.dispatchEvent(new Event("languagechange"));
        }, zh ? "en-US" : "zh-CN");
        await expect(page.locator(".micro-label").filter({ hasText: zh ? "Log detail" : "日志详情" })).toBeVisible();
        if (mode === "empty") {
          await expect(page.getByText(zh ? "Select a log" : "请选择日志")).toBeVisible();
        } else {
          await expect(page.getByRole("radio", { name: zh ? "Timeline" : "时间线", checked: true })).toBeVisible();
          await expect(page.getByRole("button", { name: zh ? "Debug" : "调试", exact: true })).toBeEnabled();
          if (mode === "local") {
            await expect(page.getByText(zh ? /local file \(no org — source navigation off\)/ : /本地文件（无组织，源码导航已关闭）/)).toBeVisible();
            await expect(page.getByRole("button", { name: /Open source|打开源码/ })).toHaveCount(0);
          }
          else await expect(page.getByRole("button", { name: /runTestsSynchronous/ })).toHaveClass(/bg-primary\/10/);
        }
      });
    }
  });
}
