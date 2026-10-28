import { expect, test, type Page } from "@playwright/test";
import { installMocks } from "./fixtures";

type Invoke = (command: string, args?: Record<string, unknown>, options?: { headers?: Record<string, string> }) => Promise<unknown>;
type IpcScope = {
  __TAURI_INTERNALS__: { invoke: Invoke };
  __ufCalls: { cmd: string; args: Record<string, unknown> }[];
  __finishOld?: () => void;
};

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`SOQL locale / SOQL 语言: ${language}`, () => {
    test.use({ locale: language });
    const words = language === "zh-CN" ? {
      org: "当前组织：DevHub。切换组织", explain: "执行计划", checking: "正在检查结果规模…",
      cancel: "取消", large: "大结果集", limit: "添加 LIMIT 2,000", result: "已返回 1 行",
      run: "运行", all: "所有行", query: "查询",
    } : {
      org: "Current org: DevHub. Switch org", explain: "Explain", checking: "Checking size…",
      cancel: "Cancel", large: "Large result set", limit: "Add LIMIT 2,000", result: "1 row returned",
      run: "Run", all: "All rows", query: "Query",
    };

    async function openQuery(page: Page) {
      await page.goto("/");
      await expect(page.getByRole("button", { name: words.org })).toBeVisible();
      await page.getByRole("button", { name: "SOQL", exact: true }).click();
      await page.getByRole("treeitem", { name: "accounts.soql" }).click();
      await expect(page.getByRole("button", { name: words.explain, exact: true })).toBeVisible();
    }

    async function selectStaging(page: Page) {
      await page.getByRole("button", { name: words.org, exact: true }).click();
      await page.getByRole("dialog").getByText("Staging", { exact: true }).click();
      const selected = language === "zh-CN" ? "当前组织：Staging。切换组织" : "Current org: Staging. Switch org";
      await expect(page.getByRole("button", { name: selected, exact: true })).toBeVisible();
    }

    test("query plans follow the selected organization / 查询计划跟随所选组织", async ({ page }) => {
      await installMocks(page);
      await openQuery(page);
      await page.getByRole("button", { name: words.org, exact: true }).click();
      await page.getByRole("dialog").getByText("Staging", { exact: true }).click();
      const selected = language === "zh-CN" ? "当前组织：Staging。切换组织" : "Current org: Staging. Switch org";
      await expect(page.getByRole("button", { name: selected, exact: true })).toBeVisible();
      await page.getByRole("button", { name: words.explain, exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as IpcScope).__ufCalls
        .filter((call) => call.cmd === "query_plan").map((call) => call.args.org)))
        .toEqual(["stg@acme.com"]);
    });

    test("localized toolbar preserves execution options / 本地化工具栏保留执行选项", async ({ page }) => {
      await installMocks(page, { count_soql: 1 });
      await openQuery(page);
      await expect(page.getByText(words.query, { exact: true })).toBeVisible();
      const all = page.getByRole("button", { name: words.all, exact: true });
      const tooling = page.getByRole("button", { name: "Tooling API", exact: true });
      await expect(all).toHaveAttribute("aria-pressed", "false");
      await all.click();
      await tooling.click();
      await expect(all).toHaveAttribute("aria-pressed", "true");
      await expect(tooling).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as IpcScope).__ufCalls
        .filter((call) => call.cmd === "run_soql").map((call) => ({
          query: call.args.query, org: call.args.org, allRows: call.args.allRows, useToolingApi: call.args.useToolingApi,
        }))))
        .toEqual([{ query: "SELECT Id, Name, AnnualRevenue FROM Account", org: "dev@acme.com", allRows: true, useToolingApi: true }]);
    });

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
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect(page.getByText(words.checking, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: words.cancel, exact: true }).click();
      await expect(page.getByText(words.checking, { exact: true })).not.toBeVisible();
      await expect(page.getByRole("button", { name: words.run, exact: true })).toBeEnabled();
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
      await page.getByRole("button", { name: words.run, exact: true }).click();
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

    test("organization changes discard delayed preflight / 组织变化后丢弃延迟预检", async ({ page }) => {
      await installMocks(page, { count_soql: 1 });
      await openQuery(page);
      await page.evaluate(() => {
        const scope = window as unknown as IpcScope;
        const invoke = scope.__TAURI_INTERNALS__.invoke;
        scope.__TAURI_INTERNALS__.invoke = (command, args = {}, options) => {
          if (command === "count_soql" && args.org === "dev@acme.com") {
            void invoke(command, args, options);
            return new Promise<null>((resolve) => { scope.__finishOld = () => resolve(null); });
          }
          return invoke(command, args, options);
        };
      });
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect(page.getByText(words.checking, { exact: true })).toBeVisible();
      await selectStaging(page);
      await expect(page.getByRole("button", { name: words.run, exact: true })).toBeEnabled();
      await page.evaluate(async () => {
        (window as unknown as IpcScope).__finishOld?.();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const calls = await page.evaluate(() => (window as unknown as IpcScope).__ufCalls);
      const count = calls.find((call) => call.cmd === "count_soql");
      expect(count).toBeTruthy();
      expect(calls.filter((call) => call.cmd === "cancel_soql").map((call) => call.args.queryId)).toEqual([count?.args.queryId]);
      expect(calls.filter((call) => call.cmd === "run_soql")).toHaveLength(0);
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as IpcScope).__ufCalls
        .filter((call) => call.cmd === "run_soql").map((call) => call.args.org))).toEqual(["stg@acme.com"]);
    });

    test("late query completion cannot replace another organization's result / 迟到查询不能替换另一组织的结果", async ({ page }) => {
      await installMocks(page, {
        count_soql: 1,
        run_soql: { columns: ["Name"], rows: [["Current fixture / 当前夹具"]], totalSize: 1, done: true, childTables: [] },
      });
      await openQuery(page);
      await page.evaluate(() => {
        const scope = window as unknown as IpcScope;
        const invoke = scope.__TAURI_INTERNALS__.invoke;
        scope.__TAURI_INTERNALS__.invoke = (command, args = {}, options) => {
          if (command === "run_soql" && args.org === "dev@acme.com") {
            void invoke(command, args, options);
            return new Promise((resolve) => { scope.__finishOld = () => resolve({
              columns: ["Name"], rows: [["Old fixture / 旧夹具"]], totalSize: 1, done: true, childTables: [],
            }); });
          }
          return invoke(command, args, options);
        };
      });
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as IpcScope).__ufCalls
        .filter((call) => call.cmd === "run_soql").length)).toBe(1);
      await selectStaging(page);
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect(page.getByText("Current fixture / 当前夹具", { exact: true })).toBeVisible();
      await page.evaluate(async () => {
        (window as unknown as IpcScope).__finishOld?.();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      await expect(page.getByText("Current fixture / 当前夹具", { exact: true })).toBeVisible();
      await expect(page.getByText("Old fixture / 旧夹具", { exact: true })).toHaveCount(0);
    });

    test("listener registration failure restores the query controls / 监听注册失败后恢复查询控件", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installMocks(page, { count_soql: 1 });
      await openQuery(page);
      await page.evaluate(() => {
        const scope = window as unknown as IpcScope;
        const invoke = scope.__TAURI_INTERNALS__.invoke;
        scope.__TAURI_INTERNALS__.invoke = (command, args = {}, options) => {
          if (command === "plugin:event|listen" && args.event === "soql-progress")
            return Promise.reject(new Error("Synthetic registration failure / 合成注册失败"));
          return invoke(command, args, options);
        };
      });
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect(page.getByText("Synthetic registration failure / 合成注册失败", { exact: false }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: words.run, exact: true })).toBeEnabled();
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as IpcScope).__ufCalls.filter((call) => call.cmd === "run_soql"))).toHaveLength(0);
    });
  });
}
