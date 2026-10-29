import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";

type Scope = { __ufCalls: Array<{ cmd: string; args: { locale?: string } }> };

for (const locale of ["en-US", "zh-CN"] as const) test.describe(locale, () => {
  test.use({ locale });
  test("synchronizes tray language at startup and on change / 启动及语言变化时同步托盘语言", async ({ page }) => {
    await gotoApp(page);
    const lastTrayLocale = () => page.evaluate(() => {
      const calls = (window as unknown as Scope).__ufCalls ?? [];
      return calls.filter((call) => call.cmd === "set_tray_locale").at(-1)?.args.locale;
    });
    await expect.poll(lastTrayLocale).toBe(locale === "zh-CN" ? "zh-CN" : "en");

    const next = locale === "zh-CN" ? "en-US" : "zh-CN";
    await page.evaluate((language) => {
      Object.defineProperty(navigator, "languages", { value: [language], configurable: true });
      window.dispatchEvent(new Event("languagechange"));
    }, next);
    await expect.poll(lastTrayLocale).toBe(next === "zh-CN" ? "zh-CN" : "en");
  });
});
