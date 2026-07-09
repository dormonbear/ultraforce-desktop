import { test, expect } from "@playwright/test";
import { gotoApp, dropLogFile } from "./fixtures";
import { MonacoEditor } from "./monaco";

/**
 * Fixed e2e journey over the mocked-IPC app (see fixtures.ts). The real
 * completion/parse logic is unit-tested in Rust; here we assert the UI
 * plumbing: branding, the file explorer (open/filter/search), run history,
 * schema refresh, and apex completion.
 */

test("brand mark is the Ultraforce logo", async ({ page }) => {
  await gotoApp(page);
  // The wordmark became an SVG logo carrying its accessible name.
  await expect(page.getByRole("img", { name: "Ultraforce" })).toBeVisible();
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

test("running a query renders results in the active tab", async ({ page }) => {
  // The SOQL run-history drawer was removed; running now simply renders the
  // result inline and keeps the query's tab active.
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();

  await page.getByText("RUN", { exact: false }).first().click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  // The query tab stays active after the run.
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();
});

test("exporting query results writes a CSV file", async ({ page }) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  await page.getByText("RUN", { exact: false }).first().click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  // Export is a dropdown: open it, then pick the CSV format.
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "CSV" }).click();
  await expect(page.getByText(/Exported .* rows to CSV/)).toBeVisible();

  const csv = await page.evaluate(() =>
    (
      window as unknown as { __ufReadFile: (p: string) => string | null }
    ).__ufReadFile("/ws/query-result.csv"),
  );
  expect(csv).not.toBeNull();
  expect(csv).toContain("Id,Name,Industry\r\n");
  expect((csv ?? "").trimEnd().split("\r\n")).toHaveLength(13); // header + 12 rows
});

test("exporting query results as JSON writes a parseable array", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  await page.getByText("RUN", { exact: false }).first().click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "JSON" }).click();
  await expect(page.getByText(/Exported .* rows to JSON/)).toBeVisible();

  const written = await page.evaluate(() =>
    (
      window as unknown as { __ufReadFile: (p: string) => string | null }
    ).__ufReadFile("/ws/query-result.json"),
  );
  expect(written).not.toBeNull();
  const parsed = JSON.parse(written ?? "null") as unknown[];
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed).toHaveLength(12);
});

test("Tooling API toggle threads use_tooling_api to run_soql", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();

  await page.getByRole("button", { name: "Tooling API" }).click();
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

  await page.getByRole("button", { name: "All rows" }).click();
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
  await expect(page.getByText("Query plan")).toBeVisible();
  await expect(page.getByText("TableScan")).toBeVisible();
  await expect(page.getByText("2.80")).toBeVisible();
  await expect(page.getByText("not selective")).toBeVisible();

  // Closing the plan returns to the results area.
  await page.getByRole("button", { name: "Close plan" }).click();
  await expect(page.getByText("Query plan")).toHaveCount(0);
});

test("opening a local .log file parses and renders it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();
  // Local files open via HTML5 drop (no more OPEN button); parse_log (mocked)
  // returns one unit at API 60.0 with a CODE_UNIT_STARTED tree node.
  await dropLogFile(page);

  // The detail header reports the parsed metadata, and the default raw tab
  // shows the log body.
  await expect(page.getByText(/API 60\.0/)).toBeVisible();
  await expect(page.getByText("minimal opened log body")).toBeVisible();

  // The timeline tab lays out the execution tree as a flame chart (the old
  // textual tree view + event filter was replaced by the canvas timeline).
  await page.getByRole("radio", { name: "timeline" }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("Apex panel exposes debug levels and applies a preset", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Apex" }).click();
  await page.getByRole("treeitem", { name: "hello.apex" }).click();

  // The toggle only renders once get_debug_config (mocked) resolves on mount.
  const toggle = page.getByRole("button", { name: "Debug levels", exact: true });
  await expect(toggle).toBeVisible();

  // Expand the config row, then change a category level (the only org preset
  // already matches the current levels, so selecting it fires nothing — editing
  // a category select is the reliable way to thread set_debug_config).
  await toggle.click();
  await expect(
    page.getByRole("combobox", { name: "Debug level preset" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Apex Profiling debug level" })
    .selectOption("FINEST");

  // set_debug_config is threaded with the edited levels (apexCode stays DEBUG).
  const args = await page.evaluate(() => {
    const calls =
      (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] })
        .__ufCalls ?? [];
    return calls.filter((c) => c.cmd === "set_debug_config").at(-1)?.args;
  });
  expect((args?.levels as Record<string, string> | undefined)?.apexCode).toBe("DEBUG");
});

test("switching org re-fetches the debug config", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Apex" }).click();
  await page.getByRole("treeitem", { name: "hello.apex" }).click();
  await expect(
    page.getByRole("button", { name: "Debug levels", exact: true }),
  ).toBeVisible();

  const getCalls = () =>
    page.evaluate(() => {
      const calls =
        (window as unknown as { __ufCalls: { cmd: string }[] }).__ufCalls ?? [];
      return calls.filter((c) => c.cmd === "get_debug_config").length;
    });
  const before = await getCalls();

  // Switch to the other org → the hook's `org` dep re-fetches the config.
  await page.getByLabel("Select Salesforce org").click();
  await page.getByText("stg@acme.com", { exact: false }).click();

  await expect.poll(getCalls).toBeGreaterThan(before);
});

test("Configure Logging dialog adds a trace flag and saves the diff", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "Configure logging" }).click();

  // Configure Logging is now an inline panel (not a dialog).
  await expect(page.getByText("Configure Logging")).toBeVisible();
  // The fixture's existing trace flag shows its traced user.
  await expect(page.getByText("Bob (bob@x.com)")).toBeVisible();

  // Add a new trace flag, pick a user and a debug level. The unsaved row is the
  // one carrying the editable Log type select (saved rows show a static label).
  await page.getByRole("button", { name: "Add trace flag" }).click();
  const newRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("combobox", { name: "Log type" }) });
  // The traced entity is a searchable combobox (~2000-user lists freeze a Select).
  await newRow.getByText("Select user").click();
  await page.getByPlaceholder("Search…").fill("Carol");
  await page.getByRole("option", { name: /Carol/ }).click();
  // Debug level stays a native <select>.
  await newRow
    .getByRole("combobox", { name: "Debug level" })
    .selectOption({ label: "FINE_LOGS" });

  await page.getByRole("button", { name: "Save", exact: true }).click();

  // The committed diff carries one added trace flag for the chosen user/level.
  const diff = await page.evaluate(() => {
    const calls =
      (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] })
        .__ufCalls ?? [];
    return calls.filter((c) => c.cmd === "save_logging_config").at(-1)?.args?.diff as
      | { traceFlagsAdded: { tracedEntityId: string; debugLevelRef: string }[] }
      | undefined;
  });
  expect(diff?.traceFlagsAdded?.length).toBe(1);
  expect(diff?.traceFlagsAdded?.[0]?.tracedEntityId).toBe("005BBB");
  expect(diff?.traceFlagsAdded?.[0]?.debugLevelRef).toBe("7dl1");
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
  // Set the relationship path via the Monaco API — keyboard typing into an editor
  // with live completion mangles the text (chars accepted mid-suggest). The
  // mocked soql_complete returns a field reached through the Owner→User rel.
  const editor = new MonacoEditor(page);
  await editor.setValueViaApi("SELECT Owner.Em");
  const email = editor.suggestWidget().getByText("Email");
  await expect(async () => {
    await page.keyboard.press("Control+Space");
    await expect(email).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 12000 });
});

test("apex annotation completion offers @AuraEnabled", async ({ page }) => {
  await gotoApp(page);
  await page.getByLabel("Apex").click();
  await page.getByText("hello.apex").click();
  // Set via the Monaco API (typing mangles under live completion), then trigger.
  const editor = new MonacoEditor(page);
  await editor.setValueViaApi("@Aura");
  const item = editor.suggestWidget().getByText("@AuraEnabled");
  await expect(async () => {
    await page.keyboard.press("Control+Space");
    await expect(item).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 12000 });
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

test("sync-result event is handled silently (no toast)", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() =>
    (window as unknown as { __ufEmit: (e: string, p: unknown) => void }).__ufEmit(
      "sync-result",
      { org: "x", added: 1, updated: 2, removed: 0 },
    ),
  );
  // The sync toast was intentionally removed — SyncToast now logs silently. No
  // toast should surface for a sync-result event.
  await expect(page.getByText(/Synced .* updates/)).toHaveCount(0);
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
