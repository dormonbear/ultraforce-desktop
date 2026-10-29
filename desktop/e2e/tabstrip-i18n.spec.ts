import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";

const panels = [
  { name: "SOQL", newEn: "New query", newZh: "新建查询" },
  { name: "Apex", newEn: "New script", newZh: "新建脚本" },
] as const;

for (const panel of panels) for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`${panel.name} ${locale}`, () => {
    test.use({ locale });
    test("localizes tab actions and retains a live rename / 本地化标签操作并保留进行中的重命名", async ({ page }) => {
      await gotoApp(page);
      if (panel.name === "Apex") await page.getByRole("button", { name: "Apex", exact: true }).click();
      await page.getByRole("button", { name: locale === "zh-CN" ? panel.newZh : panel.newEn, exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Editor content" })).toBeFocused();
      await page.getByRole("button", { name: locale === "zh-CN" ? "新建标签" : "New tab", exact: true }).click();
      await expect(page.getByRole("tab", { name: "Untitled-2" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("textbox", { name: "Editor content" })).toBeFocused();
      await expect(page.getByRole("button", { name: locale === "zh-CN" ? "所有标签" : "All tabs" })).toBeVisible();
      const original = "Untitled-1";
      await page.getByRole("tab", { name: original }).click({ button: "right" });
      const rename = locale === "zh-CN" ? "重命名" : "Rename";
      await expect(page.getByRole("menuitem", { name: locale === "zh-CN" ? "关闭其他标签" : "Close Others" })).toBeVisible();
      await page.getByRole("menuitem", { name: rename, exact: true }).click();
      const input = page.getByRole("textbox", { name: `${rename} ${original}` });
      await input.fill("Scratch_{name}$&");
      const next = locale === "zh-CN" ? "en-US" : "zh-CN";
      await page.evaluate((language) => {
        Object.defineProperty(navigator, "languages", { value: [language], configurable: true });
        window.dispatchEvent(new Event("languagechange"));
      }, next);
      const renamedInput = page.getByRole("textbox", { name: `${next === "zh-CN" ? "重命名" : "Rename"} ${original}` });
      await expect(renamedInput).toHaveValue("Scratch_{name}$&");
      await expect(renamedInput).toBeFocused();
      await renamedInput.press("Enter");
      const renamedTab = page.getByRole("tab", { name: "Scratch_{name}$&" });
      await expect(renamedTab).toBeVisible();
      await renamedTab.click({ button: "right" });
      await page.getByRole("menuitem", { name: next === "zh-CN" ? "关闭其他标签" : "Close Others" }).click();
      await expect(page.getByRole("tab", { name: "Untitled-2" })).toHaveCount(0);
      await expect(renamedTab).toBeVisible();
    });
  });
}
