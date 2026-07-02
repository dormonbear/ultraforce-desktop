import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// The Settings page (bottom-rail) hosts appearance, workspace, indexing, and
// about controls. Theme and highlight-scheme choices persist across reloads.
test("toggles the theme between light and dark", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const html = page.locator("html");
  await page.getByRole("button", { name: "dark", exact: true }).click();
  await expect(html).toHaveClass(/dark/);

  await page.getByRole("button", { name: "light", exact: true }).click();
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
  await scheme.selectOption({ label: "Monokai" });
  await expect(scheme).toHaveValue("monokai");

  // The choice is persisted to the store and survives a reload.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("combobox", { name: "Syntax highlighting scheme" }),
  ).toHaveValue("monokai");
});

test("Indexing scope invokes reindex with the chosen namespaces", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings" }).click();

  await page
    .getByRole("combobox", { name: "Index namespace scope" })
    .selectOption({ label: "Unmanaged only (skip managed packages)" });

  const args = await page.evaluate(() => {
    const calls =
      (window as unknown as { __ufCalls: { cmd: string; args: Record<string, unknown> }[] })
        .__ufCalls ?? [];
    return calls.filter((c) => c.cmd === "reindex_org").at(-1)?.args;
  });
  expect(args?.namespaces).toBeDefined();
});
