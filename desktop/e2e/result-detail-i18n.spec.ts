import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { translate } from "../src/i18n";

const text = {
  "en-US": { row1: "Row 1", row2: "Row 2", close: "Close detail panel", empty: "No child records", loaded: "1 of 2 loaded", ascending: "Sort ascending", sort: "Sort descending", clearSort: "Clear sort", copyColumn: "Copy column", copyCell: "Copy value", copiedCell: "Copied cell value", copiedColumn: "Copied 2 Name values", withChild: "Only with child records", withoutChild: "Only without child records" },
  "zh-CN": { row1: "第 1 行", row2: "第 2 行", close: "关闭详情面板", empty: "无子记录", loaded: "已加载 1 / 2", ascending: "升序排序", sort: "降序排序", clearSort: "清除排序", copyColumn: "复制列", copyCell: "复制值", copiedCell: "已复制单元格值", copiedColumn: "已复制 2 个 Name 值", withChild: "仅显示有子记录的行", withoutChild: "仅显示无子记录的行" },
} as const;

const result = {
  columns: ["Id", "Name", "Contacts"],
  rows: [["001A", "Acme", "1"], ["001B", "Globex", "0"]], totalSize: 2, done: true,
  childTables: [{
    rowIndex: 0, column: "Contacts", totalSize: 2, done: false,
    columns: ["LastName", "Cases"], rows: [["Yin", 1]],
    children: [{ rowIndex: 0, column: "Cases", totalSize: 1, done: true, columns: ["Subject"], rows: [["Synthetic"]], children: [] }],
  }],
};

type Scope = { __detailClipboard: string[] };

for (const locale of ["en-US", "zh-CN"] as const) test.describe(locale, () => {
  test.use({ locale });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const copied: string[] = [];
      Object.assign(window, { __detailClipboard: copied });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true, value: { writeText: async (value: string) => { copied.push(value); } },
      });
    });
    await gotoApp(page, { run_soql: result });
    await page.getByText("accounts.soql", { exact: true }).first().click();
    await page.getByRole("button", { name: translate(locale === "zh-CN" ? "zh-CN" : "en", "Run"), exact: true }).click();
    await expect(page.getByRole("cell", { name: "Acme" })).toBeVisible();
  });

  test("localizes nested details and keeps selection on language change / 本地化嵌套详情并在切换语言时保留选择", async ({ page }) => {
    await page.getByRole("cell", { name: "Acme" }).click();
    await expect(page.getByText(text[locale].row1)).toBeVisible();
    await expect(page.getByRole("button", { name: text[locale].close })).toBeVisible();
    await expect(page.getByText(text[locale].loaded)).toBeVisible();
    await expect(page.getByText("Yin", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic", { exact: true })).toBeVisible();

    await page.getByRole("cell", { name: "Globex" }).click();
    await expect(page.getByText(text[locale].row2)).toBeVisible();
    await expect(page.getByText(text[locale].empty)).toBeVisible();
    const next = locale === "en-US" ? "zh-CN" : "en-US";
    await page.evaluate((language) => {
      Object.defineProperty(navigator, "languages", { value: [language], configurable: true });
      window.dispatchEvent(new Event("languagechange"));
    }, next);
    await expect(page.getByText(text[next].row2)).toBeVisible();
    await expect(page.getByText(text[next].empty)).toBeVisible();
    await page.getByRole("button", { name: text[next].close }).click();
    await expect(page.getByText(text[next].empty)).toHaveCount(0);
  });

  test("localizes menus without changing sort, copy or child filtering / 本地化菜单且保留排序、复制和子记录筛选", async ({ page }) => {
    const nameHeader = page.getByRole("button", { name: "Name", exact: true });
    await nameHeader.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: text[locale].ascending })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: text[locale].clearSort })).toBeVisible();
    await page.getByRole("menuitem", { name: text[locale].sort }).click();
    await expect.poll(() => page.getByRole("cell", { name: /^(Acme|Globex)$/ }).allTextContents()).toEqual(["Globex", "Acme"]);
    await nameHeader.click({ button: "right" });
    await page.getByRole("menuitem", { name: text[locale].copyColumn }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__detailClipboard)).toEqual(["Globex\nAcme"]);
    await expect(page.getByText(text[locale].copiedColumn)).toBeVisible();

    await page.getByRole("cell", { name: "Acme" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: text[locale].copyCell }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__detailClipboard)).toEqual(["Globex\nAcme", "Acme"]);
    await expect(page.getByText(text[locale].copiedCell)).toBeVisible();

    const childHeader = page.getByRole("button", { name: "Contacts", exact: true });
    await childHeader.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: text[locale].withoutChild })).toBeVisible();
    await page.getByRole("menuitem", { name: text[locale].withChild }).click();
    await expect(page.getByRole("cell", { name: "Globex" })).toHaveCount(0);
    await childHeader.click({ button: "right" });
    await page.getByRole("menuitem", { name: text[locale].withChild }).click();
    await expect(page.getByRole("cell", { name: "Globex" })).toBeVisible();

    const next = locale === "en-US" ? "zh-CN" : "en-US";
    await page.evaluate((language) => {
      Object.defineProperty(navigator, "languages", { value: [language], configurable: true });
      window.dispatchEvent(new Event("languagechange"));
    }, next);
    await nameHeader.click({ button: "right" });
    await page.getByRole("menuitem", { name: text[next].clearSort }).click();
    await expect.poll(() => page.getByRole("cell", { name: /^(Acme|Globex)$/ }).allTextContents()).toEqual(["Acme", "Globex"]);
    await page.getByRole("cell", { name: "Acme" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: text[next].copyCell }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__detailClipboard)).toEqual(["Globex\nAcme", "Acme", "Acme"]);
    await expect(page.getByText(text[next].copiedCell)).toBeVisible();
  });
});
