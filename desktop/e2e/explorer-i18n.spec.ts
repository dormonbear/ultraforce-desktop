import { expect, test, type Page } from "@playwright/test";
import { gotoApp } from "./fixtures";

const text = {
  "en-US": { filter: "Filter by name", content: "Search in files", mode: "Toggle search mode", case: "Match case", regex: "Use regular expression", clear: "Clear search", empty: "No files match", tree: "Files", newFolder: "New Folder", folderName: "folder name", rename: "Rename", remove: "Delete" },
  "zh-CN": { filter: "按名称筛选", content: "搜索文件内容", mode: "切换搜索模式", case: "区分大小写", regex: "使用正则表达式", clear: "清除搜索", empty: "没有匹配的文件", tree: "文件", newFolder: "新建文件夹", folderName: "文件夹名称", rename: "重命名", remove: "删除" },
} as const;

async function changeLanguage(page: Page, language: string) {
  await page.evaluate((next) => {
    Object.defineProperty(navigator, "languages", { value: [next], configurable: true });
    window.dispatchEvent(new Event("languagechange"));
  }, language);
}

for (const locale of ["en-US", "zh-CN"] as const) test.describe(locale, () => {
  test.use({ locale });
  const next = locale === "en-US" ? "zh-CN" : "en-US";

  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByRole("treeitem", { name: "accounts.soql" })).toBeVisible();
  });

  test("localizes search while preserving its text and options / 本地化搜索并保留文本与选项", async ({ page }) => {
    await expect(page.getByRole("tree", { name: text[locale].tree })).toBeVisible();
    await page.getByRole("button", { name: text[locale].case, exact: true }).click();
    await page.getByRole("button", { name: text[locale].regex, exact: true }).click();
    await page.getByPlaceholder(text[locale].filter).fill("^ACCOUNTS");
    await expect(page.getByText(text[locale].empty)).toBeVisible();

    await changeLanguage(page, next);
    await expect(page.getByPlaceholder(text[next].filter)).toHaveValue("^ACCOUNTS");
    await expect(page.getByText(text[next].empty)).toBeVisible();
    await page.getByRole("button", { name: text[next].case, exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "accounts.soql" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "leads.soql" })).toHaveCount(0);

    await page.getByRole("button", { name: text[next].clear, exact: true }).click();
    await page.getByRole("button", { name: text[next].mode, exact: true }).click();
    await page.getByPlaceholder(text[next].content).fill("AnnualRevenue");
    await page.getByPlaceholder(text[next].content).press("Enter");
    await expect(page.getByRole("button", { name: /AnnualRevenue/ })).toBeVisible();
  });

  test("localizes menus and preserves an in-progress edit / 本地化菜单并保留正在编辑的内容", async ({ page }) => {
    const file = page.getByRole("treeitem", { name: "accounts.soql" });
    await file.click();
    await expect(page.getByRole("textbox", { name: "Editor content" })).toBeFocused();
    await file.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: text[locale].rename, exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: text[locale].remove, exact: true })).toBeVisible();
    await page.getByRole("menuitem", { name: text[locale].newFolder, exact: true }).click();
    await page.getByPlaceholder(text[locale].folderName).fill("archive");

    await changeLanguage(page, next);
    const input = page.getByPlaceholder(text[next].folderName);
    await expect(input).toHaveValue("archive");
    await expect(input).toBeFocused();
    await expect(file).toHaveAttribute("aria-selected", "true");
    await input.press("Escape");
    await expect(input).toHaveCount(0);

    await file.click({ button: "right" });
    await page.getByRole("menuitem", { name: text[next].rename, exact: true }).click();
    const rename = page.getByRole("tree", { name: text[next].tree }).getByRole("textbox");
    await rename.fill("renamed.soql");
    await rename.press("Enter");
    await expect(page.getByRole("treeitem", { name: "renamed.soql" })).toBeVisible();
  });
});
