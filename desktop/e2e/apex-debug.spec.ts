import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// The Debug tab lists USER_DEBUG output cleanly, away from the raw-log noise.
test("Debug tab lists USER_DEBUG messages", async ({ page }) => {
  await gotoApp(page, {
    parse_log: {
      raw: "x",
      apiVersion: "60.0",
      units: [
        {
          tree: [
            {
              label: "CODE_UNIT_STARTED",
              detail: "MyClass.run",
              durNs: 1000,
              selfNs: 0,
              children: [
                { label: "USER_DEBUG", detail: "[3] | DEBUG | hello world", durNs: null, selfNs: null, children: [] },
              ],
            },
          ],
          hotspots: [],
          statements: [],
          limits: [],
          exceptions: [],
        },
      ],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "OPEN" }).click();
  await page.getByRole("radio", { name: "debug" }).click();

  await expect(page.getByText("hello world")).toBeVisible();
});
