import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { MonacoEditor } from "./monaco";

const panels = [
  { name: "SOQL", newEn: "New query", newZh: "新建查询", hintEn: "Open a query from the sidebar", hintZh: "从侧边栏打开查询", listEn: "SOQL tabs", listZh: "SOQL 标签", content: "SELECT Id FROM Account" },
  { name: "Apex", newEn: "New script", newZh: "新建脚本", hintEn: "Open a script from the sidebar", hintZh: "从侧边栏打开脚本", listEn: "Apex tabs", listZh: "Apex 标签", content: "System.debug('hello');" },
] as const;

for (const panel of panels) for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`${panel.name} ${locale}`, () => {
    test.use({ locale });
    test("localizes the empty state and tab list / 本地化空状态和标签列表", async ({ page }) => {
      await gotoApp(page);
      if (panel.name === "Apex") await page.getByRole("button", { name: "Apex", exact: true }).click();
      await expect(page.getByText(locale === "zh-CN" ? panel.hintZh : panel.hintEn)).toBeVisible();
      const next = locale === "zh-CN" ? "en-US" : "zh-CN";
      await page.evaluate((language) => {
        Object.defineProperty(navigator, "languages", { value: [language], configurable: true });
        window.dispatchEvent(new Event("languagechange"));
      }, next);
      await expect(page.getByText(next === "zh-CN" ? panel.hintZh : panel.hintEn)).toBeVisible();
      await page.getByRole("button", { name: next === "zh-CN" ? panel.newZh : panel.newEn, exact: true }).click();
      await expect(page.getByRole("tablist", { name: next === "zh-CN" ? panel.listZh : panel.listEn })).toBeVisible();
    });

    test("localizes undo after closing a draft and restores its content / 本地化关闭草稿后的撤销并恢复内容", async ({ page }) => {
      await gotoApp(page);
      if (panel.name === "Apex") await page.getByRole("button", { name: "Apex", exact: true }).click();
      await page.getByRole("button", { name: locale === "zh-CN" ? panel.newZh : panel.newEn, exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Editor content" })).toBeFocused();
      await page.getByRole("button", { name: locale === "zh-CN" ? "新建标签" : "New tab", exact: true }).click();
      const editor = new MonacoEditor(page);
      await editor.setValueViaApi(panel.content);
      await expect(page.getByTestId("unsaved-dot")).toBeVisible();
      await page.getByRole("button", { name: `${locale === "zh-CN" ? "关闭" : "Close"} Untitled-2` }).click();
      await expect(page.getByText(`${locale === "zh-CN" ? "已关闭" : "Closed"} Untitled-2`)).toBeVisible();
      await page.getByRole("button", { name: locale === "zh-CN" ? "撤销" : "Undo" }).first().click();
      await expect(page.getByRole("tab", { name: "Untitled-2" })).toBeVisible();
      await expect.poll(() => editor.text()).toBe(panel.content);
    });
  });
}
