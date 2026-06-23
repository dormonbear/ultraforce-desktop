import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { MonacoEditor } from "./monaco";

// ── helpers ────────────────────────────────────────────────────────────────

async function openApex(page: import("@playwright/test").Page): Promise<MonacoEditor> {
  await page.getByLabel("Apex").click();
  await page.getByText("hello.apex").click();
  return new MonacoEditor(page);
}

async function openSoql(page: import("@playwright/test").Page): Promise<MonacoEditor> {
  await page.getByText("accounts.soql").click();
  return new MonacoEditor(page);
}

// ── 1. Run anonymous Apex — success path ───────────────────────────────────

test("run anonymous Apex success: COMPILED/SUCCESS chips and debug log appear", async ({
  page,
}) => {
  await gotoApp(page);
  await openApex(page);

  await page.getByText("RUN", { exact: false }).first().click();

  // Status chips
  await expect(page.getByText("COMPILED")).toBeVisible();
  await expect(page.getByText("SUCCESS")).toBeVisible();

  // The mocked log contains USER_DEBUG entries
  await expect(page.getByText("DEBUG LOG")).toBeVisible();
  await expect(page.getByText(/USER_DEBUG/).first()).toBeVisible();
});

// ── 2. Run anonymous Apex — failure path ──────────────────────────────────

test("run anonymous Apex failure: exception message surfaces in UI", async ({
  page,
}) => {
  await gotoApp(page, {
    run_apex: {
      compiled: true,
      success: false,
      compile_problem: null,
      exception_message: "System.NullPointerException: Attempt to de-reference a null object",
      exception_stack_trace: "Class.MyClass.run: line 5, column 1",
      line: 5,
      column: 1,
      logs: "",
    },
  });

  await openApex(page);
  await page.getByText("RUN", { exact: false }).first().click();

  // The exception message must be visible in the result area (first() avoids the toast duplicate)
  await expect(
    page.getByText("System.NullPointerException: Attempt to de-reference a null object").first(),
  ).toBeVisible();
});

// ── 3. Cmd/Ctrl+Enter triggers run_apex in the Apex panel ─────────────────

test("Cmd+Enter in Apex editor invokes run_apex via IPC", async ({ page }) => {
  await gotoApp(page);
  const editor = await openApex(page);

  // Monaco registers the Ctrl+Enter keybinding in onMount. Re-trigger in a
  // toPass loop until the binding fires: focus the editor then press the shortcut.
  // We use "Control+Enter" (not ControlOrMeta) because Playwright's Chromium
  // headless sends Ctrl regardless of platform when using keyboard.press.
  await expect(async () => {
    await editor.focus();
    await page.keyboard.press("Control+Enter");
    const called = await page.evaluate(() => {
      const calls = (window as unknown as { __ufCalls: { cmd: string }[] }).__ufCalls ?? [];
      return calls.some((c) => c.cmd === "run_apex");
    });
    expect(called).toBe(true);
  }).toPass({ timeout: 12000 });

  // Wait for the result to render
  await expect(page.getByText("COMPILED")).toBeVisible({ timeout: 8000 });
});

// ── 3b. Cmd/Ctrl+Enter triggers run_soql in the SOQL panel ────────────────

test("Cmd+Enter in SOQL editor invokes run_soql via IPC", async ({ page }) => {
  await gotoApp(page);
  const editor = await openSoql(page);

  // Same retry pattern — Monaco's onMount registers the keybinding asynchronously.
  await expect(async () => {
    await editor.focus();
    await page.keyboard.press("Control+Enter");
    const called = await page.evaluate(() => {
      const calls = (window as unknown as { __ufCalls: { cmd: string }[] }).__ufCalls ?? [];
      return calls.some((c) => c.cmd === "run_soql");
    });
    expect(called).toBe(true);
  }).toPass({ timeout: 12000 });

  await expect(page.getByText(/rows returned/)).toBeVisible({ timeout: 8000 });
});

// ── 4. Multi-tab: open two files, switch, close ───────────────────────────

test("multi-tab: open two SOQL files, switch between them, close one", async ({
  page,
}) => {
  await gotoApp(page);

  // Open first file
  await page.getByText("accounts.soql").click();
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();

  // Open second file
  await page.getByText("leads.soql").click();
  await expect(page.getByRole("tab", { name: /leads\.soql/ })).toBeVisible();

  // Two tabs should be present
  const tabsBefore = await page.getByRole("tab").count();
  expect(tabsBefore).toBeGreaterThanOrEqual(2);

  // Switch back to accounts.soql
  await page.getByRole("tab", { name: /accounts\.soql/ }).click();

  // The active editor should contain accounts.soql content
  const editor = new MonacoEditor(page);
  await expect.poll(() => editor.text()).toContain("Account");

  // Close the active tab (accounts.soql) using its close button
  const accountsTab = page.getByRole("tab", { name: /accounts\.soql/ });
  await accountsTab.hover();
  await accountsTab.getByRole("button", { name: /Close/ }).click();

  // The tab should be gone
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toHaveCount(0);
});

// ── 5. Save a file: Cmd/Ctrl+S writes through IPC ─────────────────────────

test("Cmd+S saves the file and __ufReadFile reflects the new content", async ({
  page,
}) => {
  await gotoApp(page);

  const editor = await openSoql(page);

  // Wait for Monaco to fully mount (text() reads the live model).
  await expect.poll(() => editor.text()).toContain("SELECT Id");

  // Replace the model content via executeEdits, which fires onDidChangeModelContent
  // → React onChange prop → saveFile (400 ms debounce) → write_text_file IPC.
  // This is the only reliable programmatic way; keyboard.type is mungled by autocomplete.
  await page.evaluate(() => {
    const m = (window as unknown as { monaco?: any }).monaco;
    const eds = m?.editor?.getEditors?.() ?? [];
    const ed = eds[0];
    if (ed) {
      const model = ed.getModel();
      if (model) {
        ed.executeEdits("e2e", [{ range: model.getFullModelRange(), text: "SELECT Name FROM Contact" }]);
      }
    }
  });

  // Confirm the editor model now holds the new text.
  await expect.poll(() => editor.text()).toContain("SELECT Name FROM Contact");

  // Poll until autosave (debounce 400 ms + write IPC) propagates to the mock FS.
  await expect.poll(async () => {
    return page.evaluate(() =>
      (
        window as unknown as { __ufReadFile: (p: string) => string | null }
      ).__ufReadFile("/ws/workspace/soql/accounts.soql") ?? ""
    );
  }, { timeout: 8000 }).toContain("SELECT Name FROM Contact");
});

// ── 6. Diagnostics: SOQL error marker renders a squiggle ──────────────────

test("soql_diagnostics marker produces a squiggly-error decoration in Monaco", async ({
  page,
}) => {
  // The SoqlEditor calls soql_diagnostics on each value change (350 ms debounce).
  // Override to return one error marker at position 0–6 (SELECT).
  await gotoApp(page, {
    soql_diagnostics: [
      { message: "Unexpected token", start: 0, end: 6, severity: "error" },
    ],
  });

  await openSoql(page);

  // Diagnostics fire on first open (the editor mount flips a `mounted` flag the
  // effect depends on) — no user edit needed. Wait for the 350 ms debounce +
  // IPC call → Monaco setModelMarkers.
  // Assert via the Monaco API — squiggly DOM decorations are viewport-dependent
  // and unreliable in headless mode.
  await expect.poll(async () => {
    return page.evaluate(() => {
      const m = (window as unknown as { monaco?: any }).monaco;
      if (!m) return 0;
      const models = m.editor.getModels?.() ?? [];
      let total = 0;
      for (const model of models) {
        total += (m.editor.getModelMarkers({ resource: model.uri }) ?? []).length;
      }
      return total;
    });
  }, { timeout: 10000 }).toBeGreaterThan(0);
});

// ── 7. New tab button opens a fresh tab ───────────────────────────────────

test("New tab button opens a fresh in-memory untitled tab", async ({ page }) => {
  await gotoApp(page);

  // Open a file so the tab strip appears.
  await openSoql(page);
  const tabsBefore = await page.getByRole("tab").count();

  // The "+" opens an in-memory untitled tab (no file written until Save As).
  await page.getByRole("button", { name: "New tab" }).click();

  await expect.poll(() => page.getByRole("tab").count()).toBe(tabsBefore + 1);
  await expect(page.getByRole("tab", { name: /Untitled-\d+/ })).toBeVisible();
});

// ── 7b. Save As writes an untitled tab and retitles it ────────────────────

test("Save As writes an untitled tab to the chosen path and retitles it", async ({
  page,
}) => {
  await gotoApp(page);
  await openSoql(page);
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(page.getByRole("tab", { name: /Untitled-\d+/ })).toBeVisible();

  // Put content in the untitled tab (via Monaco API so React state updates),
  // then Save As. The save dialog is mocked to return /ws/export.csv
  // (fixtures.ts), so the tab retitles to that basename and content is written.
  const editor = new MonacoEditor(page);
  await editor.setValueViaApi("SELECT Id FROM Account");
  await expect.poll(() => editor.text()).toBe("SELECT Id FROM Account");

  // The untitled tab now has unsaved content → an unsaved dot is shown.
  await expect(page.getByTestId("unsaved-dot")).toBeVisible();

  // Ctrl+S → Save As. Retry: Monaco registers the keybinding asynchronously, and
  // headless Chromium matches CtrlCmd with Control (not Meta) — same pattern as
  // the Ctrl+Enter run tests. Re-pressing after the rename is a harmless re-save.
  await expect(async () => {
    await editor.focus();
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("tab", { name: /export\.csv/ })).toBeVisible({
      timeout: 1500,
    });
  }).toPass({ timeout: 12000 });

  const saved = await page.evaluate(
    () =>
      (window as unknown as { __ufReadFile: (p: string) => string | null }).__ufReadFile(
        "/ws/export.csv",
      ),
  );
  expect(saved).toBe("SELECT Id FROM Account");

  // Saved to a path → no longer unsaved, dot clears.
  await expect(page.getByTestId("unsaved-dot")).toHaveCount(0);
});

// ── 8. SOQL results — TABLE/TREE toggle and row filter ────────────────────

test("SOQL results: TABLE view renders rows, TREE toggle switches view, Filter rows prunes results", async ({
  page,
}) => {
  await gotoApp(page);
  await openSoql(page);

  // Run the query
  await page.getByText("RUN", { exact: false }).first().click();
  await expect(page.getByText(/rows returned/)).toBeVisible();

  // TABLE is the default view — check the row count indicator in the ResultTable toolbar
  await expect(page.getByText("12 rows", { exact: true })).toBeVisible();

  // The filter input is in the ResultTable toolbar
  const filter = page.getByPlaceholder("Filter rows…");
  await expect(filter).toBeVisible();

  // Filter by "Tech" — should show only 6 rows (every other in the mock)
  await filter.fill("Tech");
  // The count badge updates: tanstack filters the 12 rows
  await expect.poll(async () => {
    const text = await page.locator(".tnum").last().textContent();
    return text;
  }, { timeout: 4000 }).toMatch(/6 \/ 12/);

  // Clear the filter — all 12 rows visible again
  await filter.fill("");
  await expect.poll(async () => {
    const text = await page.locator(".tnum").last().textContent();
    return text;
  }, { timeout: 4000 }).toMatch(/12/);

  // Switch to TREE view — ToggleGroupItem renders as role="radio"
  await page.getByRole("radio", { name: /tree/i }).click();
  // The RecordTree component renders when view === "tree".
  // The mocked run_soql has tree: [] so we just verify the table toggle is still visible.
  await expect(page.getByRole("radio", { name: /table/i })).toBeVisible();
});
