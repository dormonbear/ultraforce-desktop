import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";

for (const language of ["en-US", "zh-CN"]) {
  const zh = language === "zh-CN";
  test.describe(`update locale / 更新语言: ${language}`, () => {
    test.use({ locale: language });

    test("localizes a startup offer / 本地化启动时的更新提示", async ({ page }) => {
      await gotoApp(page, {
        "plugin:updater|check": {
          rid: 42, currentVersion: "0.3.33", version: "1.2.3", body: "",
        },
      });
      await expect(page.getByText(zh ? "更新 1.2.3 可用" : "Update 1.2.3 available")).toBeVisible();
      await expect(page.getByText(zh ? "新版本已准备好安装。" : "A new version is ready to install.")).toBeVisible();
      await expect(page.getByRole("button", { name: zh ? "安装并重新启动" : "Install & restart" })).toBeVisible();
    });

    test("localizes a manual up-to-date result / 本地化手动检查后的最新状态", async ({ page }) => {
      await gotoApp(page, { "plugin:updater|check": null });
      await page.getByRole("button", { name: zh ? "设置" : "Settings" }).click();
      await page.getByRole("button", { name: zh ? "检查更新" : "Check for updates" }).click();
      await expect(page.getByText(zh ? "已是最新版本" : "You're up to date")).toBeVisible();
    });
  });
}
