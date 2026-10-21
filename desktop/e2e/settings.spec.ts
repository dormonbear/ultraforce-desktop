import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// The Settings page (bottom-rail) hosts appearance, workspace, indexing, and
// about controls. Theme and highlight-scheme choices persist across reloads.
test("toggles the theme between light and dark", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const html = page.locator("html");
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(html).toHaveClass(/dark/);

  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(html).not.toHaveClass(/dark/);
});

test("changes the syntax highlighting scheme and persists it", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings" }).click();

  const scheme = page.getByRole("combobox", {
    name: "Syntax highlighting scheme",
  });
  await scheme.click();
  await page.getByRole("option", { name: "Monokai", exact: true }).click();
  await expect(scheme).toHaveText("Monokai");

  // The choice is persisted to the store and survives a reload.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("combobox", { name: "Syntax highlighting scheme" }),
  ).toHaveText("Monokai");
});

test("Indexing scope invokes reindex with the chosen namespaces", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings" }).click();

  await page.getByRole("combobox", { name: "Index scope" }).click();
  await page.getByRole("option", { name: "Unmanaged only (skip managed packages)", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const calls =
      (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] })
        .__ufCalls ?? [];
    return calls.filter((c) => c.cmd === "reindex_org").at(-1)?.args.namespaces;
  })).toBe("unmanaged");
});

test("Privacy discloses local work without offering collection controls", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("No analytics, telemetry, usage tracking, or automatic crash reports are collected or sent.")).toBeVisible();
  await expect(page.getByText(/Your scripts, execution history, preferences/)).toBeVisible();
  await expect(page.getByRole("switch", { name: /telemetry|usage statistics/i })).toHaveCount(0);
  const calls = await page.evaluate(() => (window as unknown as { __ufCalls: { cmd: string }[] }).__ufCalls);
  expect(calls.filter(({ cmd }) => /telemetry/.test(cmd))).toEqual([]);
});

test.describe("Chinese settings / 中文设置", () => {
  test.use({ locale: "zh-CN" });

  test("localizes navigation, settings and privacy while preserving controls / 本地化导航、设置及隐私说明并保留控件功能", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("button", { name: "日志", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "对象结构", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await expect(page.getByText("不收集或发送分析数据、遥测、使用记录或自动崩溃报告。")).toBeVisible();
    await expect(page.getByText(/脚本、执行历史、偏好设置/)).toBeVisible();
    await page.getByRole("radio", { name: "深色", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("combobox", { name: "索引范围" }).click();
    await page.getByRole("option", { name: "仅未托管内容（跳过托管包）", exact: true }).click();
    await expect(page.getByText("正在重新索引组织…", { exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: /遥测|使用统计/ })).toHaveCount(0);
  });
});
