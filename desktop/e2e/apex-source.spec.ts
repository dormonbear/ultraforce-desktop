import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// Jump to source: clicking a method frame in the Hotspots view fetches its
// Apex source from the org and shows it read-only. Needs org context, so the
// log is selected from the org list (dragged local logs keep source nav off).
test("clicking a method hotspot opens its source", async ({ page }) => {
  await gotoApp(page, {
    parse_log: {
      raw: "x",
      api_version: "60.0",
      units: [
        {
          tree: [],
          hotspots: [
            {
              signature: "MyClass.doWork()",
              self_ns: 5_000_000,
              total_ns: 5_000_000,
              self_bytes: 0,
              count: 1,
            },
          ],
          statements: [],
          limits: [],
          exceptions: [],
        },
      ],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
  await page.getByRole("radio", { name: "hotspots" }).click();
  await page.getByRole("button", { name: /MyClass\.doWork/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});
