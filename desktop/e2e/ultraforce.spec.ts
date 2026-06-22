import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

/**
 * Fixed e2e journey over the mocked-IPC app (see fixtures.ts). The real
 * completion/parse logic is unit-tested in Rust; here we assert the UI
 * plumbing: branding, the file explorer (open/filter/search), run history,
 * schema refresh, and apex completion.
 */

test("brand wordmark reads Ultraforce", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByText("Ultraforce", { exact: true })).toBeVisible();
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

test("exporting query results writes a CSV file", async ({ page }) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  await page.getByText("RUN", { exact: false }).first().click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  await page.getByRole("button", { name: "Export CSV" }).click();
  await expect(page.getByText(/Exported .* rows to CSV/)).toBeVisible();

  const csv = await page.evaluate(() =>
    (
      window as unknown as { __ufReadFile: (p: string) => string | null }
    ).__ufReadFile("/ws/export.csv"),
  );
  expect(csv).not.toBeNull();
  expect(csv).toContain("Id,Name,Industry\r\n");
  expect((csv ?? "").trimEnd().split("\r\n")).toHaveLength(13); // header + 12 rows
});

test("Tooling API toggle threads use_tooling_api to run_soql", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();

  await page.getByRole("checkbox", { name: "Tooling API" }).check();
  await page.getByText("RUN", { exact: false }).first().click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  const args = await page.evaluate(() => {
    const calls = (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] }).__ufCalls ?? [];
    return calls.filter((c) => c.cmd === "run_soql").at(-1)?.args;
  });
  expect(args?.useToolingApi).toBe(true);
});

test("All rows toggle threads all_rows to run_soql", async ({ page }) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();

  await page.getByRole("checkbox", { name: "All rows" }).check();
  await page.getByText("RUN", { exact: false }).first().click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  const args = await page.evaluate(() => {
    const calls = (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] }).__ufCalls ?? [];
    return calls.filter((c) => c.cmd === "run_soql").at(-1)?.args;
  });
  expect(args?.allRows).toBe(true);
});

test("Explain shows the query plan with the leading operation and cost", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();

  await page.getByRole("button", { name: "Explain" }).click();
  await expect(page.getByText("Query plan (EXPLAIN)")).toBeVisible();
  await expect(page.getByText("TableScan")).toBeVisible();
  await expect(page.getByText("2.80")).toBeVisible();
  await expect(page.getByText("not selective")).toBeVisible();

  // Closing the plan returns to the results area.
  await page.getByRole("button", { name: "Close plan" }).click();
  await expect(page.getByText("Query plan (EXPLAIN)")).toHaveCount(0);
});

test("opening a local .log file parses and renders it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "OPEN" }).click();
  // parse_log (mocked) returns a unit with a CODE_UNIT_STARTED tree node.
  await expect(page.getByText("CODE_UNIT_STARTED")).toBeVisible();
  await expect(page.getByText("MyClass.run")).toBeVisible();

  // Tree event filter: a non-matching query empties the tree, matching restores it.
  const filter = page.getByPlaceholder(/Filter events/);
  await filter.fill("zzz-no-match");
  await expect(page.getByText("— no matching events —")).toBeVisible();
  await filter.fill("CODE_UNIT");
  await expect(page.getByText("CODE_UNIT_STARTED")).toBeVisible();
});

test("reindex org shows a success toast", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Reindex org" }).click();
  await expect(page.getByText(/Reindexing org/)).toBeVisible();
});

test("selecting an org warms the sObject-name cache for FROM completion", async ({
  page,
}) => {
  await gotoApp(page);
  // FROM completion reads the in-memory sObject-name cache, which warm_schema
  // populates cheaply on org-select — independent of the heavy index_org.
  const calls = await page.evaluate(
    () => (window as unknown as { __ufCalls: { cmd: string }[] }).__ufCalls,
  );
  expect(calls.some((c) => c.cmd === "warm_schema")).toBe(true);
});

test("soql editor surfaces relationship-field completion after a dot", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  const editor = page.locator(".monaco-editor").first();
  await editor.click();
  await page.keyboard.press("Control+a");
  // Type a relationship path, then re-trigger completion until the widget shows —
  // robust against Monaco's provider not being registered the instant we type.
  // The mocked soql_complete returns a field reached through the Owner→User rel.
  await page.keyboard.type("SELECT Owner.Em");
  const email = page
    .locator(".monaco-editor .suggest-widget")
    .getByText("Email");
  await expect(async () => {
    await page.keyboard.press("Control+Space");
    await expect(email).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 12000 });
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

test("setup page guides login when no org is authed", async ({ page }) => {
  await gotoApp(page, { list_orgs: [] });
  await expect(page.getByText("Connect a Salesforce org")).toBeVisible();
  // One-click login invokes login_org with the selected environment.
  await page.getByRole("button", { name: "Log in" }).click();
  const calls = await page.evaluate(
    () => (window as unknown as { __ufCalls: { cmd: string; args: unknown }[] }).__ufCalls,
  );
  expect(calls.some((c) => c.cmd === "login_org")).toBe(true);
});

test("setup page guides install when sf CLI is missing", async ({ page }) => {
  await gotoApp(page, { list_orgs: [], sf_status: { installed: false, version: null } });
  await expect(page.getByText("Salesforce CLI not found")).toBeVisible();
  await expect(page.getByText("npm install -g @salesforce/cli")).toBeVisible();
});
