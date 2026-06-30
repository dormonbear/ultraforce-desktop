import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// Jump to source: clicking a method in the execution tree fetches its Apex
// source from the org and shows it read-only.
test("clicking a method in the tree opens its source", async ({ page }) => {
  await gotoApp(page, {
    parse_log: {
      raw: "x",
      api_version: "60.0",
      raw_sources: [],
      units: [
        {
          tree: [
            {
              label: "METHOD_ENTRY",
              detail: "[5] | 01p | MyClass.doWork()",
              dur_ns: 1000,
              self_ns: 1000,
              source: { className: "MyClass", line: 5 },
              children: [],
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
  await page.getByRole("radio", { name: "tree" }).click();
  await page.getByRole("button", { name: /MyClass\.doWork/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});
