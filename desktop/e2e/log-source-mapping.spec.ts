import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// Source mapping: a raw debug-log line the backend resolves to Apex source is
// clickable and opens that source read-only. Source navigation needs org
// context, so the log is selected from the org list (dragged local logs are
// orgless and keep source navigation off).
test("clicking a resolved raw log line jumps to its source", async ({
  page,
}) => {
  await gotoApp(page, {
    parse_log: {
      raw: "45.0 APEX_CODE,DEBUG\n08:00:00.0 (100)|METHOD_ENTRY|[5]|01p|MyClass.doWork()",
      api_version: "60.0",
      units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: [] }],
    },
    source_line_indices: [1], // the second raw line resolves to source
    source_at_line: { className: "MyClass", line: 5 },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: /runTestsSynchronous/ }).click();

  await page.locator('[title="Jump to Apex source"]').click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});
