import { expect, test, type Page } from "@playwright/test";
import { installMocks, openApexFile } from "./fixtures";

type Scope = {
  __ufCalls: { cmd: string; args: Record<string, unknown> }[];
  __copied?: string;
};

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`Apex panel locale / Apex 面板语言: ${language}`, () => {
    test.use({ locale: language });
    const words = language === "zh-CN" ? {
      header: "匿名 Apex", result: "结果", empty: "运行以查看结果", debug: "调试级别", history: "执行历史",
      run: "运行", cancel: "取消", confirm: "运行匿名 Apex", description: "在 dev@acme.com 中运行此匿名 Apex？",
      compiled: "已编译", success: "成功", compileFailed: "编译失败", line: "第 1 行，第 7 列", noLog: "无调试日志",
      copy: "复制异常", copied: "异常已复制", trace: "堆栈跟踪",
      replaceTitle: "替换编辑器内容", replaceDescription: "替换当前编辑器内容？", replace: "替换",
    } : {
      header: "Anonymous Apex", result: "Result", empty: "Run to see results", debug: "Debug levels", history: "Execution history",
      run: "Run", cancel: "Cancel", confirm: "Run anonymous Apex", description: "Run this anonymous Apex against dev@acme.com?",
      compiled: "Compiled", success: "Success", compileFailed: "Compile failed", line: "Ln 1:7", noLog: "No debug log",
      copy: "Copy exception", copied: "Exception copied", trace: "Stack trace",
      replaceTitle: "Replace editor content", replaceDescription: "Replace the current editor content?", replace: "Replace",
    };

    async function open(page: Page) {
      await page.goto("/");
      await openApexFile(page);
      await expect(page.getByText(words.header, { exact: true })).toBeVisible();
    }

    test("localizes panel labels and empty feedback / 本地化面板标签及空反馈", async ({ page }) => {
      await installMocks(page);
      await open(page);
      await expect(page.getByText(words.result, { exact: true })).toBeVisible();
      await expect(page.getByText(words.empty, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: words.debug, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: words.history, exact: true })).toBeVisible();
    });

    test("confirmation preserves cancellation and execution target / 确认保留取消及执行目标", async ({ page }) => {
      await installMocks(page, { run_apex: { compiled: true, success: true, logs: "" } });
      await page.addInitScript(() => localStorage.setItem("__uf_store", JSON.stringify({ "settings.confirmApexRun": true })));
      await open(page);
      const run = page.getByRole("button", { name: words.run, exact: true });
      await run.click();
      const dialog = page.getByRole("alertdialog", { name: words.confirm, exact: true });
      await expect(dialog).toContainText(words.description);
      await dialog.getByRole("button", { name: words.cancel, exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(await page.evaluate(() => (window as unknown as Scope).__ufCalls.filter(call => call.cmd === "run_apex"))).toEqual([]);
      await run.click();
      await dialog.getByRole("button", { name: words.run, exact: true }).click();
      await expect(page.getByText(words.noLog, { exact: true })).toBeVisible();
      const calls = await page.evaluate(() => (window as unknown as Scope).__ufCalls.filter(call => call.cmd === "run_apex"));
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual({ src: "System.debug('hi');", org: "dev@acme.com" });
    });

    test("localizes compile fallback and source location / 本地化编译后备提示及源码位置", async ({ page }) => {
      await installMocks(page, { run_apex: { compiled: false, success: false, compileProblem: null, line: 1, column: 7, logs: "" } });
      await open(page);
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect(page.getByText(words.compiled, { exact: true })).toBeVisible();
      await expect(page.getByText(words.success, { exact: true })).toBeVisible();
      await expect(page.getByText(words.compileFailed, { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: words.line, exact: true }).click();
      await expect(page.getByText(words.noLog, { exact: true })).toBeVisible();
    });

    test("localizes exception controls while preserving raw payload / 本地化异常控件并保留原始内容", async ({ page }) => {
      await installMocks(page, { run_apex: {
        compiled: true, success: false, logs: "", exceptionMessage: "SyntheticException: {org}", exceptionStackTrace: "Class.Example.run: line 7",
      } });
      await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text: string) => { (window as unknown as Scope).__copied = text; },
      } }));
      await open(page);
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await page.getByRole("button", { name: words.trace, exact: true }).click();
      await expect(page.getByText("Class.Example.run: line 7", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: words.copy, exact: true }).click();
      await expect(page.getByText(words.copied, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as Scope).__copied)).toBe("SyntheticException: {org}\nClass.Example.run: line 7");
    });

    test("history replacement preserves cancel and selected source / 历史替换保留取消及所选源码", async ({ page }) => {
      await installMocks(page, { run_apex: { compiled: true, success: true, logs: "" } });
      await page.addInitScript(() => localStorage.setItem("__uf_store", JSON.stringify({ "apex-history": [{
        id: "synthetic", org: "dev@acme.com", source: "System.debug('history {org}');", logs: "", compiled: true, success: true, exceptionMessage: null, at: 0,
      }] })));
      await open(page);
      async function loadHistory() {
        await page.getByRole("button", { name: words.history, exact: true }).click();
        const drawer = page.getByRole("dialog", { name: "Apex execution history", exact: true });
        await drawer.getByRole("button").filter({ hasText: "System.debug('history {org}');" }).click();
        await drawer.getByRole("button", { name: "Load", exact: true }).click();
        const confirm = page.getByRole("alertdialog", { name: words.replaceTitle, exact: true });
        await expect(confirm).toContainText(words.replaceDescription);
        return confirm;
      }
      await (await loadHistory()).getByRole("button", { name: words.cancel, exact: true }).click();
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect(page.getByText(words.noLog, { exact: true })).toBeVisible();
      await (await loadHistory()).getByRole("button", { name: words.replace, exact: true }).click();
      await page.getByRole("button", { name: words.run, exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ufCalls
        .filter(call => call.cmd === "run_apex").map(call => call.args.src)))
        .toEqual(["System.debug('hi');", "System.debug('history {org}');"]);
    });

    test("mounted language changes preserve source and execution / 挂载后语言变化保留源码及执行", async ({ page }) => {
      await installMocks(page);
      await open(page);
      const next = language === "en-US" ? "zh-CN" : "en-US";
      const editor = page.getByRole("textbox", { name: "Editor content", exact: true });
      await editor.press("F1");
      const palette = page.getByRole("textbox", { name: "Type to narrow down results.", exact: true });
      const initialCommand = language === "zh-CN" ? "运行匿名 Apex" : "Run anonymous Apex";
      await palette.fill(`> ${initialCommand}`);
      await expect(page.getByRole("option").filter({ hasText: initialCommand })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.evaluate(locale => {
        Object.defineProperty(navigator, "languages", { configurable: true, value: [locale] });
        window.dispatchEvent(new Event("languagechange"));
      }, next);
      await expect(page.getByText(next === "zh-CN" ? "匿名 Apex" : "Anonymous Apex", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as Scope).__ufCalls.filter(call => call.cmd === "run_apex"))).toEqual([]);
      await page.getByRole("textbox", { name: "Editor content", exact: true }).press("F1");
      const command = next === "zh-CN" ? "运行匿名 Apex" : "Run anonymous Apex";
      await page.getByRole("textbox", { name: "Type to narrow down results.", exact: true }).fill(`> ${command}`);
      await page.getByRole("option").filter({ hasText: command }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ufCalls.filter(call => call.cmd === "run_apex").map(call => call.args)))
        .toEqual([{ src: "System.debug('hi');", org: "dev@acme.com" }]);
    });
  });
}
