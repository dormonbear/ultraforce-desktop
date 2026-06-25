import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// The Insights tab runs detectors over a parsed log and lists actionable
// findings. Here a query that runs 6× (varying the bind literal) must be flagged
// as in-a-loop — proving fingerprint grouping + the detector + the UI wiring.
test("Insights tab flags SOQL run in a loop", async ({ page }) => {
  const statements = Array.from({ length: 6 }, (_, i) => ({
    kind: "soql",
    text: `SELECT Id FROM Contact WHERE AccountId = '001x${i}'`,
    rows: 2,
    dur_ns: 1_000_000,
  }));
  await gotoApp(page, {
    parse_log: {
      raw: "x",
      api_version: "67.0",
      units: [{ tree: [], hotspots: [], statements, limits: [], exceptions: [] }],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "OPEN" }).click();
  await page.getByRole("radio", { name: "insights" }).click();

  await expect(page.getByText(/likely inside a loop/)).toBeVisible();
  await expect(page.getByText(/6×/)).toBeVisible();
  await expect(page.getByText(/Fix:/)).toBeVisible();

  // A finding links to its evidence: jump to the Queries tab.
  await page.getByRole("button", { name: /View queries/ }).click();
  await expect(page.getByText("STATEMENT")).toBeVisible();
});
