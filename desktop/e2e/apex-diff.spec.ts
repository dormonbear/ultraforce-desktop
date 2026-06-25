import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// Compare loads a baseline log; a Diff tab then shows the current log vs the
// baseline. (The diff math is unit-tested in logDiff.test.ts; this covers the
// wiring: Compare → baseline loaded → Diff tab appears and renders.)
test("Compare loads a baseline and opens the Diff tab", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "OPEN" }).click();

  // No Diff tab until a baseline is loaded.
  await expect(page.getByRole("radio", { name: "diff" })).toHaveCount(0);

  await page.getByRole("button", { name: "COMPARE" }).click();

  // Compare selects the Diff tab and renders the A→B summary.
  await expect(page.getByRole("radio", { name: "diff" })).toBeVisible();
  await expect(page.getByText(/Baseline \(A\)/)).toBeVisible();
});
