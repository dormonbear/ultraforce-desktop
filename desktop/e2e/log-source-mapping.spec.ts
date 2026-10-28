import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./fixtures";

const src = (className: string, line: number | null) => ({ className, line });

// Opening an org log (list-row select) resolves which raw lines map to Apex
// source (`source_line_indices`) and makes them clickable; clicking a mapped
// USER_DEBUG line jumps to its inherited class + line (`source_at_line`). The
// old dedicated tree tab folded into this raw-view jump.
const RAW =
  "67.0 APEX\n16:00:00.0 (20)|METHOD_ENTRY|[5]|01p|MyClass.doWork()\n16:00:00.0 (30)|USER_DEBUG|[8]|DEBUG|hello";

async function changeLocale(page: Page, locale: string) {
  await page.evaluate(value => {
    Object.defineProperty(navigator, "languages", { configurable: true, value: [value] });
    window.dispatchEvent(new Event("languagechange"));
  }, locale);
}

test("clicking a statement line jumps to its inherited class", async ({
  page,
}) => {
  await gotoApp(page, {
    get_log: {
      raw: RAW,
      apiVersion: "60.0",
      units: [
        { tree: [], hotspots: [], statements: [], limits: [], exceptions: [] },
      ],
    },
    // The USER_DEBUG line (raw index 2) is clickable and inherits MyClass:8.
    source_line_indices: [2],
    source_at_line: src("MyClass", 8),
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
  await page.getByRole("button", { name: /USER_DEBUG.*hello/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.getByRole("heading")).toContainText("line 8");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});

// A method-entry raw line maps to source too.
test("clicking a raw log line jumps to its source", async ({ page }) => {
  await gotoApp(page, {
    get_log: {
      raw: RAW,
      apiVersion: "60.0",
      units: [
        { tree: [], hotspots: [], statements: [], limits: [], exceptions: [] },
      ],
    },
    source_line_indices: [1],
    source_at_line: src("MyClass", 5),
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
  await page.getByRole("button", { name: /METHOD_ENTRY.*doWork/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`keyboard source navigation / 键盘源码导航: ${locale}`, () => {
    test.use({ locale });
    for (const key of ["Enter", "Space"] as const) {
      test(`opens the mapped source with ${key} after filtering / 筛选后使用 ${key} 打开映射源码`, async ({ page }) => {
        await gotoApp(page, {
          get_log: {
            raw: RAW,
            apiVersion: "60.0",
            units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: [] }],
          },
          source_line_indices: [2],
          source_at_line: src("MyClass", 8),
        });
        await page.getByRole("button", { name: locale === "zh-CN" ? "日志" : "Logs", exact: true }).click();
        await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
        await page.getByRole("textbox", { name: locale === "zh-CN" ? "筛选日志" : "Filter log", exact: true }).fill("hello");
        const row = page.getByRole("button", { name: /USER_DEBUG.*hello/ });
        await expect(row).toBeVisible();
        await page.getByRole("button", { name: locale === "zh-CN" ? "复制日志" : "Copy log", exact: true }).focus();
        await page.keyboard.press("Tab");
        await expect(row).toBeFocused();
        await page.keyboard.press(key);
        await expect(page.getByRole("dialog").getByRole("heading")).toContainText("MyClass");
        await expect(page.getByRole("dialog").getByRole("heading")).toContainText(locale === "zh-CN" ? "第 8 行" : "line 8");
        await expect.poll(() => page.evaluate(() => (
          window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] }
        ).__ufCalls.filter(call => call.cmd === "source_at_line").map(call => call.args)))
          .toEqual([{ body: RAW, line: 2 }]);
      });
    }

    test("localizes shared log/source views live and preserves raw content / 实时本地化共享日志及源码视图并保留原始内容", async ({ page }) => {
      const zh = locale === "zh-CN";
      const labels = (chinese: boolean) => chinese ? {
        logs: "日志", filter: "筛选日志", placeholder: "筛选日志…", debug: "仅调试", highlight: "高亮",
        copy: "复制日志", copied: "日志已复制", empty: "没有匹配的行", line: "第 8 行", close: "关闭",
      } : {
        logs: "Logs", filter: "Filter log", placeholder: "filter log…", debug: "Debug Only", highlight: "Highlight",
        copy: "Copy log", copied: "Log copied", empty: "No matching lines", line: "line 8", close: "Close",
      };
      const initial = labels(zh), switched = labels(!zh);
      // Capture only fixture copies, leaving the real clipboard untouched. / 仅捕获夹具复制，不改变真实剪贴板。
      await page.addInitScript(() => {
        const copies: string[] = [];
        (window as unknown as { __logCopies: string[] }).__logCopies = copies;
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (text: string) => { copies.push(text); } },
        });
      });
      await gotoApp(page, {
        get_log: { raw: RAW, apiVersion: "60.0", units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: [] }] },
        source_line_indices: [2],
        source_at_line: src("MyClass", 8),
        fetch_apex_source: { name: "MyClass", kind: "ApexClass", body: "public class MyClass {\n\n\n\n\n\n\n  // RAW_{line}_$&\n}" },
      });
      await page.getByRole("button", { name: initial.logs, exact: true }).click();
      await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
      const filter = page.getByRole("textbox", { name: initial.filter, exact: true });
      await expect(filter).toHaveAttribute("placeholder", initial.placeholder);
      await expect(page.getByRole("checkbox", { name: initial.highlight, exact: true })).toBeChecked();
      await page.getByRole("checkbox", { name: initial.debug, exact: true }).check();
      await expect(page.getByRole("button", { name: /METHOD_ENTRY.*doWork/ })).toHaveCount(0);
      await page.getByRole("button", { name: initial.copy, exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __logCopies: string[] }).__logCopies)).toEqual([RAW]);
      await expect(page.getByText(initial.copied, { exact: true })).toBeVisible();
      await filter.fill("missing");
      await expect(page.getByText(initial.empty, { exact: true })).toBeVisible();
      await changeLocale(page, zh ? "en-US" : "zh-CN");
      const translated = page.getByRole("textbox", { name: switched.filter, exact: true });
      await expect(translated).toHaveValue("missing");
      await expect(page.getByText(switched.empty, { exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: switched.debug, exact: true })).toBeChecked();
      await translated.fill("hello");
      const row = page.getByRole("button", { name: /USER_DEBUG.*hello/ });
      await row.focus();
      await row.press("Enter");
      const heading = page.getByRole("dialog").getByRole("heading");
      await expect(heading).toContainText("MyClass");
      await expect(heading).toContainText(switched.line);
      await expect(page.getByRole("dialog").getByRole("button", { name: switched.close, exact: true })).toBeVisible();
      await expect(page.getByRole("dialog").locator(".monaco-editor")).toBeVisible();
      const sourceCalls = () => page.evaluate(() => (window as unknown as {
        __ufCalls: { cmd: string }[];
      }).__ufCalls.filter(call => call.cmd === "fetch_apex_source").length);
      await expect.poll(sourceCalls).toBe(1);
      await changeLocale(page, locale);
      await expect(heading).toContainText(initial.line);
      expect(await sourceCalls()).toBe(1);
      await page.getByRole("dialog").getByRole("button", { name: initial.close, exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  });
}
