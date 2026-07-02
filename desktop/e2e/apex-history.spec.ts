import { test, expect } from "@playwright/test";
import { gotoApp, openApexFile } from "./fixtures";

// Every anonymous-Apex run is recorded to a persistent history drawer so you can
// revisit or reload a previous script and its debug log.
async function runApexOnce(page: import("@playwright/test").Page) {
  await openApexFile(page);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText("Success")).toBeVisible();
}

test("records a run and reloads its source from history", async ({ page }) => {
  await gotoApp(page);
  await runApexOnce(page);

  await page.getByRole("button", { name: "Execution history" }).click();
  const drawer = page.getByRole("dialog", { name: "Apex execution history" });
  await expect(drawer).toBeVisible();

  // The run is listed with its status and source snippet.
  const entry = drawer
    .getByRole("button")
    .filter({ hasText: "System.debug('hi')" });
  await expect(entry).toBeVisible();

  // Opening the entry surfaces its detail with a "Load" action.
  await entry.click();
  await expect(drawer.getByRole("button", { name: /Load/ })).toBeVisible();
});

test("clears the execution history", async ({ page }) => {
  await gotoApp(page);
  await runApexOnce(page);

  await page.getByRole("button", { name: "Execution history" }).click();
  const drawer = page.getByRole("dialog", { name: "Apex execution history" });
  await expect(
    drawer.getByRole("button").filter({ hasText: "System.debug('hi')" }),
  ).toBeVisible();

  await drawer.getByRole("button", { name: "Clear history" }).click();
  await expect(
    drawer.getByRole("button").filter({ hasText: "System.debug('hi')" }),
  ).toHaveCount(0);
});
