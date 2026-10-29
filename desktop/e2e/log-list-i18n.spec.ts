import { expect, test } from "@playwright/test";
import { gotoApp, installMocks } from "./fixtures";

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`log list locale / 日志列表语言: ${locale}`, () => {
    test.use({ locale });

    test("keeps selection, filtering and save actions through a language change / 切换语言时保留选中、筛选和保存操作", async ({ page }) => {
      const zh = locale === "zh-CN";
      await gotoApp(page);
      await page.getByRole("button", { name: zh ? "日志" : "Logs", exact: true }).click();
      const row = page.getByRole("button", { name: /runTestsSynchronous/ });
      await row.click();
      const input = page.getByLabel(zh ? "筛选日志列表" : "Filter logs", { exact: true });
      await input.fill("Xu");
      await expect(row).toHaveClass(/bg-primary\/10/);
      await expect(row.locator(`[aria-label="${zh ? "已缓存到本地" : "Cached locally"}"]`)).toBeVisible();

      await page.getByRole("button", { name: zh ? "为自己跟踪 30 分钟" : "Trace myself for 30 minutes" }).click();
      await expect(page.getByRole("button", { name: zh ? /正在跟踪您，剩余/ : /Tracing you —/ })).toBeVisible();
      await page.evaluate(language => {
        Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
        window.dispatchEvent(new Event("languagechange"));
      }, zh ? "en-US" : "zh-CN");

      const translatedInput = page.getByLabel(zh ? "Filter logs" : "筛选日志列表", { exact: true });
      await expect(translatedInput).toHaveValue("Xu");
      await expect(row).toHaveClass(/bg-primary\/10/);
      await expect(row).toContainText(zh ? "Success" : "成功");
      await expect(page.getByRole("button", { name: zh ? /Tracing you —/ : /正在跟踪您，剩余/ })).toBeVisible();
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: zh ? "Save log…" : "保存日志…" }).click();
      await expect(page.getByText(zh ? "Log saved" : "日志已保存")).toBeVisible();
      await translatedInput.fill("missing");
      await expect(page.getByText(zh ? "No logs match this filter." : "没有日志匹配此筛选条件。")).toBeVisible();
      await page.getByRole("button", { name: zh ? "Clear filter" : "清除筛选" }).click();
      await expect(page.getByRole("button", { name: /opalrest/ })).toBeVisible();
    });

    test("localizes save failures / 本地化保存失败提示", async ({ page }) => {
      const zh = locale === "zh-CN";
      await installMocks(page);
      await page.addInitScript(() => {
        type Invoke = (command: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
        const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;
        const invoke = internals.invoke;
        internals.invoke = (command, args, options) => command === "plugin:dialog|save"
          ? Promise.reject(new Error("synthetic failure"))
          : invoke(command, args, options);
      });
      await page.goto("/");
      await page.getByRole("button", { name: zh ? "日志" : "Logs", exact: true }).click();
      await page.getByRole("button", { name: /runTestsSynchronous/ }).click({ button: "right" });
      await page.getByRole("menuitem", { name: zh ? "保存日志…" : "Save log…" }).click();
      await expect(page.getByText(zh ? "保存失败：synthetic failure" : "Save failed: synthetic failure")).toBeVisible();
    });
  });
}
