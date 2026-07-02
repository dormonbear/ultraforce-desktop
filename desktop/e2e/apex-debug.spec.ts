import { test, expect } from "@playwright/test";
import { gotoApp, openLocalLog } from "./fixtures";

// The raw log view can filter down to USER_DEBUG output cleanly, away from the
// rest of the log noise, via its "Debug Only" toggle.
test("raw log filters to USER_DEBUG lines only", async ({ page }) => {
  const body = [
    "45.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO",
    "08:00:00.0 (100)|USER_DEBUG|[3]|DEBUG|hello world",
    "08:00:00.1 (200)|SOQL_EXECUTE_BEGIN|[5]|SELECT Id FROM Account",
  ].join("\n");
  // showLocalLog renders view.raw, which comes from parse_log (it re-attaches
  // the body it holds), so the debug lines must live in the parsed fixture.
  await gotoApp(page, {
    parse_log: {
      raw: body,
      api_version: "60.0",
      units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: [] }],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await openLocalLog(page);

  // Raw view is the default detail tab; the debug-only toggle hides non-debug
  // lines so only the USER_DEBUG message remains.
  await expect(page.getByText("hello world")).toBeVisible();
  await page.getByRole("checkbox", { name: "Show debug lines only" }).check();
  await expect(page.getByText("hello world")).toBeVisible();
  await expect(page.getByText(/SOQL_EXECUTE_BEGIN/)).toHaveCount(0);
});
