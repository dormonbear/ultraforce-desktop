import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { MonacoEditor } from "./monaco";

/**
 * The "Confirm before running anonymous Apex" setting gates Run behind an
 * in-app Radix AlertDialog (window.confirm is a silent no-op in the Tauri
 * webview). The flag is seeded into the mocked store; the dialog is real DOM,
 * so we drive it by clicking its buttons and assert whether run_apex fired.
 */

async function openApex(page: import("@playwright/test").Page): Promise<MonacoEditor> {
  await page.getByLabel("Apex").click();
  await page.getByText("hello.apex").click();
  return new MonacoEditor(page);
}

/** Persist the confirm-run flag before the app boots (mock store reads localStorage). */
async function seedConfirmFlag(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() =>
    localStorage.setItem(
      "__uf_store",
      JSON.stringify({ "settings.confirmApexRun": true }),
    ),
  );
}

function ranApex(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const list =
      (window as unknown as { __ufCalls: { cmd: string }[] }).__ufCalls ?? [];
    return list.some((c) => c.cmd === "run_apex");
  });
}

/** Ctrl+Enter runs Apex; the Monaco keybinding registers on mount, so retry
 * until the confirmation dialog appears. */
async function triggerRun(
  page: import("@playwright/test").Page,
  editor: MonacoEditor,
): Promise<void> {
  const dialog = page.getByRole("alertdialog");
  await expect(async () => {
    await editor.focus();
    await page.keyboard.press("Control+Enter");
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 12000 });
}

test("confirm-run: accepting the dialog runs the Apex", async ({ page }) => {
  await seedConfirmFlag(page);
  await gotoApp(page);
  const editor = await openApex(page);

  await triggerRun(page, editor);
  await page.getByRole("alertdialog").getByRole("button", { name: "Run" }).click();

  await expect.poll(() => ranApex(page)).toBe(true);
});

test("confirm-run: cancelling the dialog blocks the run", async ({ page }) => {
  await seedConfirmFlag(page);
  await gotoApp(page);
  const editor = await openApex(page);

  await triggerRun(page, editor);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("alertdialog")).toBeHidden();
  expect(await ranApex(page)).toBe(false);
});

test("without the flag, Run does not prompt", async ({ page }) => {
  // No seedConfirmFlag → setting defaults off → one-click run, no dialog.
  await gotoApp(page);
  const editor = await openApex(page);

  await expect(async () => {
    await editor.focus();
    await page.keyboard.press("Control+Enter");
    expect(await ranApex(page)).toBe(true);
  }).toPass({ timeout: 12000 });

  await expect(page.getByRole("alertdialog")).toBeHidden();
});
