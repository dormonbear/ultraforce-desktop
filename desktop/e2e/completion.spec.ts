import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { MonacoEditor } from "./monaco";

/**
 * Editor-UX e2e for completion, snippet insertion, the trimmed context menu,
 * and Format Document. The completion/format *logic* is unit-tested in Rust;
 * here — borrowing VS Code's smoke-test approach — we drive Monaco by keyboard
 * and assert the resulting BUFFER, not just that a widget appeared. The mocked
 * IPC (fixtures.ts) returns deterministic candidates / formatted text so the UI
 * plumbing is what is under test.
 */

async function openApex(page: import("@playwright/test").Page): Promise<MonacoEditor> {
  await page.getByLabel("Apex").click();
  await page.getByText("hello.apex").click();
  return new MonacoEditor(page);
}

async function openSoql(page: import("@playwright/test").Page): Promise<MonacoEditor> {
  await page.getByText("accounts.soql").click();
  return new MonacoEditor(page);
}

test("accepting a collection type inserts the generic <> snippet", async ({
  page,
}) => {
  // The frontend maps List/Set/Map to a snippet that drops the cursor inside <>.
  await gotoApp(page, { apex_complete: [{ label: "List", kind: "class" }] });
  const editor = await openApex(page);

  await editor.setText("List");
  await editor.waitForSuggestion("List");
  await editor.acceptSuggestion();

  // The accepted snippet must carry the generic brackets (cursor lands inside).
  // `contains` rather than `equals` so a stray un-cleared char can't mask the
  // real assertion: that `<>` was inserted, not a plain `List`.
  await expect.poll(() => editor.text()).toContain("List<>");
});

test("the editor context menu is trimmed to the essentials", async ({ page }) => {
  await gotoApp(page);
  const editor = await openApex(page);
  await editor.setText("Integer x = 1;");

  const menu = await editor.openContextMenu();
  // Kept: Format Document. Removed by trimContextMenu: Change All Occurrences
  // (editor.action.changeAll) and Command Palette (editor.action.quickCommand).
  await expect(menu.getByText("Format Document")).toBeVisible();
  await expect(menu.getByText("Change All Occurrences")).toHaveCount(0);
  await expect(menu.getByText("Command Palette")).toHaveCount(0);
});

test("Format Document reformats a SOQL buffer via format_soql", async ({
  page,
}) => {
  const formatted = "SELECT Id\nFROM Account\nWHERE Name = 'x'";
  await gotoApp(page, { format_soql: formatted });
  const editor = await openSoql(page);

  // Use the file's loaded content (fixtures.ts) rather than typing — Monaco's
  // auto-close/auto-indent make multi-line typing an unreliable buffer source.
  // Format Document replaces the whole range with the mocked result.
  await editor.formatDocument();
  await expect.poll(() => editor.text()).toBe(formatted);

  // The provider threaded the editor's (original) content to the backend.
  const query = await page.evaluate(() => {
    const calls =
      (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] })
        .__ufCalls ?? [];
    return calls.filter((c) => c.cmd === "format_soql").at(-1)?.args?.query;
  });
  expect(query).toBe("SELECT Id, Name, AnnualRevenue FROM Account");
});

test("Format Document reformats an Apex buffer via format_apex", async ({
  page,
}) => {
  const formatted = "if (x) {\n    foo();\n}";
  await gotoApp(page, { format_apex: formatted });
  const editor = await openApex(page);

  // File content is "System.debug('hi');" (fixtures.ts). Format replaces it.
  await editor.formatDocument();
  await expect.poll(() => editor.text()).toBe(formatted);

  const src = await page.evaluate(() => {
    const calls =
      (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] })
        .__ufCalls ?? [];
    return calls.filter((c) => c.cmd === "format_apex").at(-1)?.args?.src;
  });
  expect(src).toBe("System.debug('hi');");
});
