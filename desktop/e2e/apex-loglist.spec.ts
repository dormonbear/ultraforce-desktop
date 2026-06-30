import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// The log list shows enriched rows (user / duration / size / time) and supports
// text filtering by operation or user.
test("log list shows metadata and filters by text", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();

  const okRow = page.getByRole("button", { name: /runTestsSynchronous/ });
  const failRow = page.getByRole("button", { name: /opalrest/ });

  // Enriched metadata is visible on the success row.
  await expect(okRow).toContainText("Xu Jerry");
  await expect(okRow).toContainText("46.1s");
  await expect(okRow).toContainText("115.9 KB");

  // Text filter narrows by operation.
  await page.getByPlaceholder("Filter operation / user").fill("opalrest");
  await expect(failRow).toBeVisible();
  await expect(okRow).toBeHidden();
});

// The list head is persisted per org so reopening the app shows it instantly
// (no re-download).
test("persists the log list head to the store", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();
  await expect(page.getByRole("button", { name: /runTestsSynchronous/ })).toBeVisible();

  const cached = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("__uf_store") ?? "{}");
    const key = Object.keys(store).find((k) => k.startsWith("logs.list."));
    return key ? store[key] : null;
  });

  expect(Array.isArray(cached)).toBe(true);
  expect(
    (cached as { operation: string }[]).some((r) => r.operation.includes("opalrest")),
  ).toBe(true);
});
