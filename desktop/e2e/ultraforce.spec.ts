import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

/**
 * Fixed e2e journey over the mocked-IPC app (see fixtures.ts). The real
 * completion/parse logic is unit-tested in Rust; here we assert the UI
 * plumbing: branding, tab rename persistence, run history, and schema refresh.
 */

test("brand wordmark reads ULTRAFORCE", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByText("ULTRAFORCE", { exact: true })).toBeVisible();
});

test("tab rename persists across reload", async ({ page }) => {
  await gotoApp(page);
  const tab = page.getByRole("tab").first();
  await tab.dblclick();
  const input = page.getByRole("textbox", { name: /Rename/ });
  await input.fill("My Saved Query");
  await input.press("Enter");
  await expect(page.getByRole("tab", { name: /My Saved Query/ })).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("tab", { name: /My Saved Query/ })).toBeVisible();
});

test("running a query records history and reopens it in a tab", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByText("RUN", { exact: false }).first().click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  await page.getByRole("button", { name: "Run history" }).click();
  const drawer = page.getByRole("dialog", { name: "Run history" });
  await expect(drawer).toBeVisible();
  const entry = drawer.getByRole("button").filter({ hasText: "soql" }).first();
  await expect(entry).toBeVisible();

  const tabsBefore = await page.getByRole("tab").count();
  await entry.click();
  await expect(page.getByRole("tab")).toHaveCount(tabsBefore + 1);
});

test("schema refresh shows a success toast", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Refresh offline schema" }).click();
  await expect(page.getByText(/Refreshed schema cache/)).toBeVisible();
});

test("apex annotation completion offers @AuraEnabled", async ({ page }) => {
  await gotoApp(page);
  await page.getByLabel("Apex").click();
  const editor = page.locator(".monaco-editor").first();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("@Aura");
  // Monaco suggest widget; mocked apex_complete returns @AuraEnabled.
  await expect(
    page.locator(".monaco-editor .suggest-widget").getByText("@AuraEnabled"),
  ).toBeVisible({ timeout: 5000 });
});
