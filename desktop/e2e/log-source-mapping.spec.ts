import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

const src = (className: string, line: number | null) => ({ className, line });

// A statement line (USER_DEBUG) inherits its enclosing method's class, so it is
// now clickable in the tree and jumps to that class — not just method entries.
test("clicking a statement line in the tree jumps to its inherited class", async ({
  page,
}) => {
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
              self_ns: 500,
              source: src("MyClass", 5),
              children: [
                {
                  label: "USER_DEBUG",
                  detail: "[8] | DEBUG | hello",
                  dur_ns: null,
                  self_ns: null,
                  source: src("MyClass", 8),
                  children: [],
                },
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
  await page.getByRole("radio", { name: "tree" }).click();
  await page.getByRole("button", { name: /hello/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.getByRole("heading")).toContainText("line 8");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});

// Raw-view lines that map to source are clickable too (via raw_sources).
test("clicking a raw log line jumps to its source", async ({ page }) => {
  await gotoApp(page, {
    parse_log: {
      raw: "67.0 APEX\n16:00:00.0 (20)|METHOD_ENTRY|[5]|01p|MyClass.doWork()\n16:00:00.0 (30)|USER_DEBUG|[8]|DEBUG|hello",
      api_version: "60.0",
      raw_sources: [null, src("MyClass", 5), src("MyClass", 8)],
      units: [
        { tree: [], hotspots: [], statements: [], limits: [], exceptions: [] },
      ],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "OPEN" }).click();
  // Raw view is the default tab; click the USER_DEBUG line.
  await page.getByRole("button", { name: /USER_DEBUG.*hello/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("MyClass");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});
