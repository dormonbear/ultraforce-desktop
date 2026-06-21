import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

/**
 * Fixed e2e journey over the mocked-IPC app (see fixtures.ts). The real
 * completion/parse logic is unit-tested in Rust; here we assert the UI
 * plumbing: branding, the file explorer (open/filter/search), run history,
 * schema refresh, and apex completion.
 */

test("brand wordmark reads ULTRAFORCE", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByText("ULTRAFORCE", { exact: true })).toBeVisible();
});

test("explorer lists files and opens one in a tab (persists across reload)", async ({
  page,
}) => {
  await gotoApp(page);
  await expect(page.getByText("accounts.soql")).toBeVisible();
  await page.getByText("accounts.soql").click();
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();
});

test("name filter prunes the tree", async ({ page }) => {
  await gotoApp(page);
  await page.getByPlaceholder("Filter by name").fill("lead");
  await expect(page.getByText("leads.soql")).toBeVisible();
  await expect(page.getByText("accounts.soql")).toHaveCount(0);
});

test("content search finds a line and opens the file", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Toggle search mode" }).click();
  const box = page.getByPlaceholder("Search in files");
  await box.fill("AnnualRevenue");
  await box.press("Enter");
  await page
    .getByText("SELECT Id, Name, AnnualRevenue", { exact: false })
    .click();
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();
});

test("running a query records history and reopens it in a tab", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();

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

test("reindex org shows a success toast", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Reindex org" }).click();
  await expect(page.getByText(/Reindexing org/)).toBeVisible();
});

test("soql editor surfaces relationship-field completion after a dot", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  const editor = page.locator(".monaco-editor").first();
  await editor.click();
  await page.keyboard.press("Control+a");
  // `.` is a SOQL completion trigger; the mocked soql_complete returns a field
  // reached through the Owner→User relationship.
  await page.keyboard.type("SELECT Owner.");
  await expect(
    page.locator(".monaco-editor .suggest-widget").getByText("Email"),
  ).toBeVisible({ timeout: 5000 });
});

test("apex annotation completion offers @AuraEnabled", async ({ page }) => {
  await gotoApp(page);
  await page.getByLabel("Apex").click();
  await page.getByText("hello.apex").click();
  const editor = page.locator(".monaco-editor").first();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("@Aura");
  // Monaco suggest widget; mocked apex_complete returns @AuraEnabled.
  await expect(
    page.locator(".monaco-editor .suggest-widget").getByText("@AuraEnabled"),
  ).toBeVisible({ timeout: 5000 });
});

test("top bar shows indexing progress then clears when done", async ({
  page,
}) => {
  await gotoApp(page);
  await page.evaluate(() =>
    (window as unknown as { __ufEmit: (e: string, p: unknown) => void }).__ufEmit(
      "index-progress",
      { org: "x", phase: "sobjects", done: 120, total: 340 },
    ),
  );
  await expect(page.getByText("Indexing objects 120/340")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __ufEmit: (e: string, p: unknown) => void }).__ufEmit(
      "index-progress",
      { org: "x", phase: "done", done: 340, total: 340 },
    ),
  );
  await expect(page.getByText(/Indexing objects/)).toHaveCount(0);
});

test("sync-result event shows a toast", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() =>
    (window as unknown as { __ufEmit: (e: string, p: unknown) => void }).__ufEmit(
      "sync-result",
      { org: "x", added: 1, updated: 2, removed: 0 },
    ),
  );
  // sonner renders the text twice (visible toast + aria-live); match the first.
  await expect(page.getByText("Synced 3 updates").first()).toBeVisible();
});
