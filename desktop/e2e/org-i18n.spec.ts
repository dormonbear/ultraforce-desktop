import { expect, test } from "@playwright/test";
import { installMocks } from "./fixtures";

const copy = {
  "en-US": {
    switcher: "Switch org", current: "Current org: DevHub. Switch org", configure: "Configure DevHub",
    edit: "Edit DevHub", alias: "Alias (optional)", api: "API version (optional)",
    timeout: "Timeout in seconds (optional)", blue: "Blue", save: "Save", close: "Close",
    badApi: "API version must be a number like 58 or 58.0",
    badTimeout: "Timeout must be a positive whole number of seconds",
    currentAlias: "Current org: {name}<组织>. Switch org", target: "Target org: {name}<组织>",
    staging: "Current org: Staging. Switch org", sandbox: "Sandbox", defaultVersion: "60.0 (default)",
  },
  "zh-CN": {
    switcher: "切换组织", current: "当前组织：DevHub。切换组织", configure: "配置 DevHub",
    edit: "编辑 DevHub", alias: "别名（可选）", api: "API 版本（可选）",
    timeout: "超时时长，单位秒（可选）", blue: "蓝色", save: "保存", close: "关闭",
    badApi: "API 版本必须是 58 或 58.0 这样的数字",
    badTimeout: "超时时长必须为正整数秒",
    currentAlias: "当前组织：{name}<组织>。切换组织", target: "目标组织：{name}<组织>",
    staging: "当前组织：Staging。切换组织", sandbox: "沙盒", defaultVersion: "60.0（默认）",
  },
} as const;

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`organization locale / 组织语言: ${language}`, () => {
    test.use({ locale: language });
    const labels = copy[language];

    test("validates, saves literal aliases and labels the target / 校验、保存原文别名并标注目标组织", async ({ page }, testInfo) => {
      await installMocks(page, { org_api_version: "60.0" });
      await page.goto("/");
      await page.getByRole("button", { name: labels.current, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: labels.switcher })).toBeVisible();
      await dialog.getByRole("button", { name: labels.configure, exact: true }).click();
      await expect(dialog.getByRole("heading", { name: labels.edit })).toBeVisible();
      await expect(dialog.getByLabel(labels.api, { exact: true })).toHaveAttribute("placeholder", labels.defaultVersion);
      await page.screenshot({ path: testInfo.outputPath("org-edit.png") });
      await dialog.getByLabel(labels.api, { exact: true }).fill("not-a-version");
      await dialog.getByRole("button", { name: labels.save, exact: true }).click();
      await expect(page.getByText(labels.badApi, { exact: true })).toBeVisible();
      await dialog.getByLabel(labels.api, { exact: true }).fill("60");
      await dialog.getByLabel(labels.timeout, { exact: true }).fill("0");
      await dialog.getByRole("button", { name: labels.save, exact: true }).click();
      await expect(page.getByText(labels.badTimeout, { exact: true })).toBeVisible();
      await dialog.getByLabel(labels.timeout, { exact: true }).fill("30");
      await dialog.getByLabel(labels.alias, { exact: true }).fill(" {name}<组织> ");
      await dialog.getByRole("button", { name: labels.blue, exact: true }).click();
      await dialog.getByRole("button", { name: labels.save, exact: true }).click();
      await expect(dialog.getByRole("heading", { name: labels.switcher })).toBeVisible();
      await dialog.getByRole("button", { name: labels.close, exact: true }).click();
      await expect(page.getByRole("button", { name: labels.currentAlias, exact: true })).toBeVisible();
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("__uf_store") ?? "{}"));
      expect(stored["orgConfig.dev@acme.com"]).toEqual({
        alias: "{name}<组织>", color: "blue", apiVersion: "60.0", timeoutSecs: 30,
      });
      await page.getByRole("button", { name: "New query", exact: true }).click();
      await expect(page.getByLabel(labels.target, { exact: true })).toBeVisible();
    });

    test("switches using unchanged usernames / 使用未改变的用户名切换", async ({ page }) => {
      await installMocks(page, { list_orgs: [
        { username: "dev@acme.com", alias: "DevHub", isDefault: true },
        { username: "stg@acme.com", alias: "Staging", isSandbox: true, isDefault: false },
      ] });
      await page.goto("/");
      await page.getByRole("button", { name: labels.current, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(labels.sandbox, { exact: true })).toBeVisible();
      await dialog.getByText("Staging", { exact: true }).click();
      await expect(page.getByRole("button", { name: labels.staging, exact: true })).toBeVisible();
      const target = await page.evaluate(() => (window as unknown as {
        __ufCalls: { cmd: string; args: { username?: string } }[];
      }).__ufCalls.filter(call => call.cmd === "set_target_org").at(-1)?.args.username);
      expect(target).toBe("stg@acme.com");
    });
  });
}
