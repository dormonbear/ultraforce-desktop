import { test, expect } from "@playwright/test";
import { gotoApp, dropLogFile } from "./fixtures";

// The raw log view's "Debug Only" filter isolates USER_DEBUG output from the
// raw-log noise (the old dedicated "debug" tab folded into this toggle).
test("Debug tab lists USER_DEBUG messages", async ({ page }) => {
  // parseLogView re-attaches `raw` from the opened body (parse_log omits it),
  // so the USER_DEBUG content must be carried by the dropped file body.
  const body = [
    "45.0 APEX_CODE,DEBUG",
    "08:00:00.0 (1)|METHOD_ENTRY|[1]|01p|MyClass.run()",
    "08:00:00.1 (2)|USER_DEBUG|[3]|DEBUG|hello world",
  ].join("\n");
  await gotoApp(page, {
    parse_log: {
      apiVersion: "60.0",
      units: [
        { tree: [], hotspots: [], statements: [], limits: [], exceptions: [] },
      ],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await dropLogFile(page, body);

  // The USER_DEBUG line is in the raw view; the Debug Only filter drops the
  // METHOD_ENTRY noise and keeps only the debug output.
  await page.getByRole("checkbox", { name: "Show debug lines only" }).click();

  await expect(page.getByText("hello world")).toBeVisible();
  await expect(page.getByText(/MyClass\.run/)).toHaveCount(0);
});
