import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// Jump to source: clicking a method frame (Hotspots) fetches its Apex source
// from the org and shows it read-only. Source navigation needs an org, so the
// log is opened via a list-row select (not a local drag-drop, which is orgless).
test("clicking a method opens its source", async ({ page }) => {
  await gotoApp(page, {
    get_log: {
      raw: "x",
      apiVersion: "60.0",
      units: [
        {
          tree: [],
          hotspots: [
            {
              signature: "MyClass.doWork()",
              selfNs: 2_000_000,
              totalNs: 2_000_000,
              selfBytes: 0,
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
