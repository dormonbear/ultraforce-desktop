import { expect, test } from "@playwright/test";
import { installMocks } from "./fixtures";

const raw = "Salesforce error (status 1): MALFORMED_QUERY: SYNTHETIC_DETAIL {value} $&";

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`error detail locale / 错误详情语言: ${locale}`, () => {
    test.use({ locale });

    test("localizes the disclosure without changing its contents / 本地化展开标签并保留错误内容", async ({ page }) => {
      const zh = locale === "zh-CN";
      await installMocks(page, { count_soql: 1 });
      await page.goto("/");
      await page.getByRole("button", { name: "SOQL", exact: true }).click();
      await page.getByRole("treeitem", { name: "accounts.soql" }).click();
      await page.evaluate((error) => {
        const scope = window as unknown as { __TAURI_INTERNALS__: { invoke: (...args: unknown[]) => Promise<unknown> } };
        const invoke = scope.__TAURI_INTERNALS__.invoke;
        scope.__TAURI_INTERNALS__.invoke = (...args) => args[0] === "run_soql" ? Promise.reject({ message: error }) : invoke(...args);
      }, raw);
      await page.getByRole("button", { name: zh ? "运行" : "Run", exact: true }).click();
      const results = page.getByTestId("results");
      await expect(results.getByText("SYNTHETIC_DETAIL {value} $&", { exact: true })).toBeVisible();
      const details = results.locator("details");
      await expect(details.locator("summary")).toHaveText(zh ? "原始错误" : "Raw error");
      await details.locator("summary").click();
      await expect(details).toHaveAttribute("open", "");
      await expect(details.locator("pre")).toHaveText(raw);
      await page.evaluate(language => {
        Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
        window.dispatchEvent(new Event("languagechange"));
      }, zh ? "en-US" : "zh-CN");
      await expect(details.locator("summary")).toHaveText(zh ? "Raw error" : "原始错误");
      await expect(details).toHaveAttribute("open", "");
      await expect(details.locator("pre")).toHaveText(raw);
    });
  });
}
