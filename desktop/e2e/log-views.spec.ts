import { test, expect } from "@playwright/test";
import { gotoApp, dropLogFile } from "./fixtures";

// The Queries detail tab summarises SOQL/DML statements in a parsed log — the
// surface for spotting slow or repeated queries.
test("Queries tab lists SOQL statements with a summary", async ({ page }) => {
  await gotoApp(page, {
    parse_log: {
      raw: "x",
      apiVersion: "60.0",
      units: [
        {
          tree: [],
          hotspots: [],
          statements: [
            { kind: "soql", text: "SELECT Id FROM Account", rows: 3, durNs: 2_000_000 },
          ],
          limits: [],
          exceptions: [],
        },
      ],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await dropLogFile(page);
  await page.getByRole("radio", { name: "queries" }).click();

  await expect(page.getByText(/1 SOQL/)).toBeVisible();
  await expect(page.getByText("SELECT Id FROM Account")).toBeVisible();
});

// The log list toolbar offers a one-click "trace myself" that starts a 30-minute
// self-trace via the backend.
test("Set My Trace starts a 30-minute self-trace", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();

  await page.getByRole("button", { name: "Trace myself for 30 minutes" }).click();
  await expect(page.getByText(/Tracing you for 30 min/)).toBeVisible();

  const called = await page.evaluate(() => {
    const calls = (window as unknown as { __ufCalls: { cmd: string }[] }).__ufCalls ?? [];
    return calls.some((c) => c.cmd === "quick_self_trace");
  });
  expect(called).toBe(true);
});
