import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

const src = (className: string, line: number | null) => ({ className, line });

// Opening an org log (list-row select) resolves which raw lines map to Apex
// source (`source_line_indices`) and makes them clickable; clicking a mapped
// USER_DEBUG line jumps to its inherited class + line (`source_at_line`). The
// old dedicated tree tab folded into this raw-view jump.
const RAW =
  "67.0 APEX\n16:00:00.0 (20)|METHOD_ENTRY|[5]|01p|MyClass.doWork()\n16:00:00.0 (30)|USER_DEBUG|[8]|DEBUG|hello";

test("clicking a statement line jumps to its inherited class", async ({
  page,
}) => {
  await gotoApp(page, {
    get_log: {
      raw: RAW,
      apiVersion: "60.0",
      units: [
        { tree: [], hotspots: [], statements: [], limits: [], exceptions: [] },
      ],
    },
    // The USER_DEBUG line (raw index 2) is clickable and inherits MyClass:8.
    source_line_indices: [2],
    source_at_line: src("MyClass", 8),
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
  await page.getByRole("button", { name: /USER_DEBUG.*hello/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.getByRole("heading")).toContainText("line 8");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});

// A method-entry raw line maps to source too.
test("clicking a raw log line jumps to its source", async ({ page }) => {
  await gotoApp(page, {
    get_log: {
      raw: RAW,
      apiVersion: "60.0",
      units: [
        { tree: [], hotspots: [], statements: [], limits: [], exceptions: [] },
      ],
    },
    source_line_indices: [1],
    source_at_line: src("MyClass", 5),
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
  await page.getByRole("button", { name: /METHOD_ENTRY.*doWork/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});
