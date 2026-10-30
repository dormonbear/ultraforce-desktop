import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";

for (const language of ["en-US", "zh-CN"]) {
  const zh = language === "zh-CN";
  test.describe(`logging configuration locale / 日志配置语言: ${language}`, () => {
    test.use({ locale: language });

    test("localizes controls while preserving the saved values / 本地化控件并保留保存的值", async ({ page }) => {
      await gotoApp(page);
      await page.getByRole("button", { name: zh ? "日志" : "Logs" }).click();
      await page.getByRole("button", { name: zh ? "配置日志" : "Configure logging" }).click();
      await expect(page.getByText(zh ? "跟踪标志" : "Trace Flags", { exact: true })).toBeVisible();
      await expect(page.locator(".micro-label").filter({ hasText: zh ? /^调试级别$/ : /^Debug Levels$/ })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: zh ? "被跟踪实体" : "Traced Entity" })).toBeVisible();

      const saved = page.getByRole("row").filter({ hasText: "Bob (bob@x.com)" });
      await saved.locator("td").nth(4).getByRole("button").first().click();
      await expect(page.getByRole("button", { name: zh ? "上个月" : "Previous month" })).toBeVisible();
      await expect(page.getByRole("button", { name: zh ? "下个月" : "Next month" })).toBeVisible();
      await expect(page.getByLabel(zh ? "时间" : "Time", { exact: true })).toBeVisible();
      if (zh) await expect(page.getByText(/\d{4}年\d{1,2}月/)).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: zh ? "添加跟踪标志" : "Add trace flag" }).click();
      const added = page.getByRole("row").filter({ has: page.getByRole("combobox", { name: zh ? "日志类型" : "Log type" }) });
      const entity = added.getByRole("combobox", { name: zh ? "选择用户" : "Select user", exact: true });
      await entity.fill("NO_SUCH_SYNTHETIC_USER");
      await expect(page.getByText(zh ? "没有匹配项。" : "No match.").first()).toBeVisible();
      await entity.fill("Carol");
      await page.getByRole("option", { name: /Carol/ }).click();
      await added.getByRole("combobox", { name: zh ? "调试级别" : "Debug level", exact: true }).selectOption({ label: "FINE_LOGS" });

      await page.getByRole("button", { name: zh ? "添加调试级别" : "Add debug level" }).click();
      const level = page.getByRole("row").filter({ has: page.getByRole("textbox", { name: zh ? "调试级别名称" : "Debug level name" }) });
      await level.getByRole("combobox", { name: zh ? "调试级别预设" : "Debug level preset" }).selectOption({ label: zh ? "仅 Apex" : "Apex Only" });
      await page.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();

      const diff = await page.evaluate(() => {
        const calls = (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] }).__ufCalls ?? [];
        return calls.filter((call) => call.cmd === "save_logging_config").at(-1)?.args.diff as {
          traceFlagsAdded: { tracedEntityId: string; debugLevelRef: string }[];
          debugLevelsAdded: { developerName: string; levels: { apexCode: string } }[];
        };
      });
      expect(diff.traceFlagsAdded[0]).toMatchObject({ tracedEntityId: "005BBB", debugLevelRef: "7dl1" });
      expect(diff.debugLevelsAdded[0]).toMatchObject({ developerName: "NEW_LEVEL", levels: { apexCode: "DEBUG" } });
    });

    test("retains a partial save failure after reload / 重新加载后保留部分保存失败详情", async ({ page }) => {
      await gotoApp(page, {
        save_logging_config: { results: [{ ok: false, sobject: "DebugLevel", op: "create", error: "SYNTHETIC_FAILURE / 合成失败" }] },
      });
      await page.getByRole("button", { name: zh ? "日志" : "Logs" }).click();
      await page.getByRole("button", { name: zh ? "配置日志" : "Configure logging" }).click();
      await page.getByRole("button", { name: zh ? "添加调试级别" : "Add debug level" }).click();
      await page.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
      await expect(page.getByText("DebugLevel create: SYNTHETIC_FAILURE / 合成失败")).toBeVisible();
      await expect(page.getByText(zh ? "日志配置：1 项失败" : "Logging config: 1 failed")).toBeVisible();
      await expect(page.getByRole("button", { name: zh ? "保存" : "Save", exact: true })).toBeVisible();
    });
  });
}

test("changes language without losing the calendar view or edits / 切换语言时保留日历视图和编辑", async ({ page }) => {
  await page.addInitScript(() => {
    let language = "en-US";
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => [language] });
    Object.assign(window, { __setTestLanguage: (next: string) => { language = next; window.dispatchEvent(new Event("languagechange")); } });
  });
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "Configure logging" }).click();
  await page.getByRole("button", { name: "Add trace flag" }).click();
  const added = page.getByRole("row").filter({ has: page.getByRole("combobox", { name: "Log type" }) });
  await added.getByRole("combobox", { name: "Select user" }).fill("Carol");
  await page.getByRole("option", { name: /Carol/ }).click();

  const saved = page.getByRole("row").filter({ hasText: "Bob (bob@x.com)" });
  await saved.locator("td").nth(4).getByRole("button").first().click();
  await page.getByRole("button", { name: "Next month" }).click();
  const expectedMonth = await page.evaluate(() => {
    const date = new Date("2099-01-01T00:00:00.000+0000");
    const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return `${next.getFullYear()}年${next.getMonth() + 1}月`;
  });
  await page.evaluate(() => (window as unknown as { __setTestLanguage: (value: string) => void }).__setTestLanguage("zh-CN"));
  await expect(page.getByText(expectedMonth, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "上个月" })).toBeVisible();
  await page.keyboard.press("Escape");
  const localized = page.getByRole("row").filter({ has: page.getByRole("combobox", { name: "日志类型" }) });
  await expect(localized.getByRole("button", { name: /Carol/ })).toBeVisible();
});
