import { expect, test, type Page } from "@playwright/test";
import { installMocks } from "./fixtures";

type Invoke = (command: string, args?: Record<string, unknown>, options?: { headers?: Record<string, string> }) => Promise<unknown>;
type IpcScope = {
  __TAURI_INTERNALS__: { invoke: Invoke };
  __ufCalls: { cmd: string; args: Record<string, unknown> }[];
};

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`SOQL locale / SOQL 语言: ${language}`, () => {
    test.use({ locale: language });
    const words = language === "zh-CN" ? {
      org: "当前组织：DevHub。切换组织", explain: "执行计划", checking: "正在检查结果规模…",
      cancel: "取消", large: "大结果集", limit: "添加 LIMIT 2,000", result: "已返回 1 行",
    } : {
      org: "Current org: DevHub. Switch org", explain: "Explain", checking: "Checking size…",
      cancel: "Cancel", large: "Large result set", limit: "Add LIMIT 2,000", result: "1 row returned",
    };

    async function openQuery(page: Page) {
      await page.goto("/");
      await expect(page.getByRole("button", { name: words.org })).toBeVisible();
      await page.getByRole("button", { name: "SOQL", exact: true }).click();
      await page.getByRole("treeitem", { name: "accounts.soql" }).click();
      await expect(page.getByRole("button", { name: words.explain, exact: true })).toBeVisible();
    }

    test("cancel uses the localized control and stops preflight / 本地化取消控件停止预检", async ({ page }) => {
      await installMocks(page);
      await openQuery(page);
      await page.evaluate(() => {
        const scope = window as unknown as IpcScope;
        const invoke = scope.__TAURI_INTERNALS__.invoke;
        const pending = new Map<unknown, (value: null) => void>();
        scope.__TAURI_INTERNALS__.invoke = (command, args = {}, options) => {
          if (command === "count_soql") {
            void invoke(command, args, options);
            return new Promise<null>((resolve) => pending.set(args.queryId, resolve));
          }
          if (command === "cancel_soql") pending.get(args.queryId)?.(null);
          return invoke(command, args, options);
        };
      });
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.getByText(words.checking, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: words.cancel, exact: true }).click();
      await expect(page.getByText(words.checking, { exact: true })).not.toBeVisible();
      await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
      const calls = await page.evaluate(() => (window as unknown as IpcScope).__ufCalls);
      const count = calls.filter((call) => call.cmd === "count_soql");
      const cancel = calls.filter((call) => call.cmd === "cancel_soql");
      expect(count).toHaveLength(1);
      expect(cancel).toHaveLength(1);
      expect(cancel[0].args.queryId).toBe(count[0].args.queryId);
      expect(calls.filter((call) => call.cmd === "run_soql")).toHaveLength(0);
    });

    test("localized size guard preserves LIMIT syntax / 本地化规模保护保留 LIMIT 语法", async ({ page }, testInfo) => {
      await installMocks(page, {
        count_soql: 10000,
        run_soql: { columns: ["Id"], rows: [["synthetic"]], totalSize: 1, done: true, childTables: [] },
      });
      await openQuery(page);
      await page.getByRole("button", { name: "Run", exact: true }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: words.large }) });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("10,000");
      await expect(dialog).toContainText("5,000");
      await dialog.screenshot({ path: testInfo.outputPath(`soql-size-guard-${language}.png`) });
      await dialog.getByRole("button", { name: words.limit, exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText(words.result, { exact: false })).toBeVisible();
      const calls = await page.evaluate(() => (window as unknown as IpcScope).__ufCalls.filter((call) => call.cmd === "run_soql"));
      expect(calls).toHaveLength(1);
      expect(calls[0].args.query).toBe("SELECT Id, Name, AnnualRevenue FROM Account\nLIMIT 2000");
      expect(calls[0].args.org).toBe("dev@acme.com");
    });
  });
}
