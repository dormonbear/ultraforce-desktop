import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { translate } from "../src/i18n";
import { MonacoEditor } from "./monaco";

type Scope = {
  __ufReadFile: (path: string) => string | null;
  __ownedNativeApi: { at: typeof Array.prototype.at; resize: typeof ResizeObserver };
  __ownedResize: { target: HTMLDivElement; observer: ResizeObserver; width: number };
};
for (const locale of ["en-US", "zh-CN"] as const) test.describe(locale, () => {
test.use({ locale });
for (const missing of ["native", "ResizeObserver", "Array.at", "combined"]) {
  test(`startup and query with ${missing} APIs / 启动及查询 API 兼容`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((missing) => {
      Object.assign(window, { __ownedNativeApi: { at: Array.prototype.at, resize: window.ResizeObserver } });
      if (missing === "ResizeObserver" || missing === "combined") {
        Object.defineProperty(window, "ResizeObserver", { value: undefined, configurable: true });
      }
      if (missing === "Array.at" || missing === "combined") {
        Object.defineProperty(Array.prototype, "at", { value: undefined, configurable: true });
      }
    }, missing);
    // Listen before navigation so initialization errors cannot race registration. / 导航前监听，避免初始化错误早于注册。
    const firstError = page.waitForEvent("pageerror", { timeout: 7_000 }).then((error) => error.message);
    await gotoApp(page);
    const file = page.getByText("accounts.soql", { exact: true });
    const startup = await Promise.race([
      file.waitFor({ state: "visible", timeout: 5_000 }).then(() => null),
      firstError,
    ]);
    expect(startup).toBeNull();
    await file.click();
    const editor = new MonacoEditor(page);
    await expect.poll(() => editor.text()).toBe("SELECT Id, Name, AnnualRevenue FROM Account");
    const suffix = " LIMIT 12 /* 本地 {draft} */";
    const query = "SELECT Id, Name, AnnualRevenue FROM Account" + suffix;
    await editor.focus();
    await page.keyboard.press("End");
    await page.keyboard.insertText(suffix);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as Scope).__ufReadFile("/ws/workspace/soql/accounts.soql"),
    )).toBe(query);
    await page.getByRole("button", { name: translate(locale === "zh-CN" ? "zh-CN" : "en", "Run"), exact: true }).click();
    await expect(page.getByRole("cell", { name: /^Account \d+$/ })).toHaveCount(12);
    const preserved = await page.evaluate((missing) => {
      const before = (window as unknown as Scope).__ownedNativeApi;
      return {
        at: missing === "Array.at" || missing === "combined" || typeof before.at !== "function" || Array.prototype.at === before.at,
        resize: missing === "ResizeObserver" || missing === "combined" || typeof before.resize !== "function" || window.ResizeObserver === before.resize,
      };
    }, missing);
    expect(preserved).toEqual({ at: true, resize: true });
    // Require real resize delivery, not merely a constructor that avoids throwing. / 要求真实尺寸通知，而非仅构造时不抛错。
    await page.evaluate(() => {
      const target = document.createElement("div");
      target.style.cssText = "position:fixed;left:-10000px;top:0;width:120px;height:20px";
      document.body.append(target);
      const probe = { target, width: 0, observer: new ResizeObserver((entries) => { probe.width = entries[0].contentRect.width; }) };
      (window as unknown as Scope).__ownedResize = probe;
      probe.observer.observe(target);
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ownedResize.width)).toBe(120);
    await page.evaluate(() => { (window as unknown as Scope).__ownedResize.target.style.width = "240px"; });
    await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ownedResize.width)).toBe(240);
    await page.evaluate(() => {
      const probe = (window as unknown as Scope).__ownedResize;
      probe.observer.disconnect();
      probe.target.remove();
    });
    expect(errors).toEqual([]);
  });
}
});
