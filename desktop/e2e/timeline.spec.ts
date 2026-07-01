import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// Smoke test: the Timeline tab (flame chart) renders a canvas once a log is
// opened. Same log-open steps as log-source-mapping.spec.ts (default fixtures
// already provide a minimal parse_log).
test("timeline tab renders a flame canvas", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "OPEN" }).click();

  await page.getByRole("radio", { name: "timeline" }).click();

  const canvas = page.locator("canvas");
  await expect(canvas.first()).toBeVisible();
});
