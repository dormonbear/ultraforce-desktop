import { expect, test } from "@playwright/test";
import { installMocks } from "./fixtures";

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`setup locale / 设置语言: ${language}`, () => {
    test.use({ locale: language });
    const zh = language === "zh-CN";
    const labels = zh ? {
      not_found: "未找到 Salesforce CLI", outdated: "Salesforce CLI 版本过旧",
      path_issue: "应用的 PATH 中未找到 Salesforce CLI", retry: "重试", copy: "复制命令",
      copied: "已复制到剪贴板", title: "连接 Salesforce 组织", alias: "别名（可选）",
      custom: "自定义域名 / 我的域…", login: "登录", url: "实例 URL",
      missingUrl: "请输入自定义实例 URL", connected: "组织已连接", close: "关闭",
    } : {
      not_found: "Salesforce CLI not found", outdated: "Salesforce CLI is too old",
      path_issue: "Salesforce CLI not on this app’s PATH", retry: "Retry", copy: "Copy command",
      copied: "Copied to clipboard", title: "Connect a Salesforce org", alias: "Alias (optional)",
      custom: "Custom domain / My Domain…", login: "Log in", url: "Instance URL",
      missingUrl: "Enter a custom instance URL", connected: "Org connected", close: "Close",
    };

    for (const state of ["not_found", "outdated", "path_issue"] as const) {
      test(`CLI guidance / CLI 指引: ${state}`, async ({ page }) => {
        await installMocks(page, {
          list_orgs: [],
          sf_status: { state, version: "1.9.0", minVersion: "2.0.0", foundAt: "/synthetic/{minimum}/sf" },
        });
        await page.goto("/");
        await expect(page.getByRole("heading", { name: labels[state] })).toBeVisible();
        await expect(page.getByRole("button", { name: labels.retry, exact: true })).toBeVisible();
        if (state === "path_issue") {
          await expect(page.getByText(/\/synthetic\/\{minimum\}\/sf/)).toBeVisible();
        } else {
          const command = state === "outdated" ? "npm update -g @salesforce/cli" : "npm install -g @salesforce/cli";
          await expect(page.getByText(command, { exact: true })).toBeVisible();
          await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
            configurable: true, value: { writeText: async (text: string) => {
              localStorage.setItem("synthetic-copied-command", text);
            } },
          }));
          await page.getByRole("button", { name: labels.copy }).click();
          await expect(page.getByText(labels.copied, { exact: true })).toBeVisible();
          expect(await page.evaluate(() => localStorage.getItem("synthetic-copied-command"))).toBe(command);
        }
      });
    }

    test("connect form validates and preserves login arguments / 连接表单验证并保留登录参数", async ({ page }) => {
      await installMocks(page, { list_orgs: [] });
      await page.goto("/");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: labels.title })).toBeVisible();
      await expect(main.getByText(labels.alias, { exact: true })).toBeVisible();
      await main.getByRole("combobox").click();
      await page.getByRole("option", { name: labels.custom }).click();
      await main.getByRole("button", { name: labels.login, exact: true }).click();
      await expect(page.getByText(labels.missingUrl, { exact: true })).toBeVisible();
      await main.getByLabel(labels.url, { exact: true }).fill(" https://synthetic.my.salesforce.com ");
      await main.getByLabel(labels.alias, { exact: true }).fill(" 合成-org ");
      await main.getByRole("button", { name: labels.login, exact: true }).click();
      await expect(page.getByText(labels.connected, { exact: true })).toBeVisible();
      const calls = await page.evaluate(() => (window as unknown as {
        __ufCalls: { cmd: string; args: unknown }[];
      }).__ufCalls.filter((call) => call.cmd === "login_org"));
      expect(calls).toEqual([{ cmd: "login_org", args: {
        instanceUrl: "https://synthetic.my.salesforce.com", alias: "合成-org", setDefault: true,
      } }]);
    });

    test("connection dialog has a localized close control / 连接对话框提供本地化关闭控件", async ({ page }) => {
      await installMocks(page);
      await page.goto("/");
      await page.getByRole("button", { name: "Current org: DevHub. Switch org" }).click();
      await page.getByRole("button", { name: "Connect org…" }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", {
        name: labels.title,
      }) });
      await expect(dialog.getByRole("heading", { name: labels.title })).toBeVisible();
      await expect(dialog.getByRole("button", { name: labels.login, exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: labels.close, exact: true }).click();
      await expect(dialog).not.toBeVisible();
    });
  });
}
