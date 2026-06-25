import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// The log list shows enriched rows (user / duration / size / time) and supports
// text + status + user filtering.
test("log list shows metadata and filters", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();

  const okRow = page.getByRole("button", { name: /runTestsSynchronous/ });
  const failRow = page.getByRole("button", { name: /opalrest/ });

  // Enriched metadata is visible on the success row.
  await expect(okRow).toContainText("Xu Jerry");
  await expect(okRow).toContainText("46.1s");
  await expect(okRow).toContainText("115.9 KB");

  // Status filter (radio group): "Fail" hides the successful runTests row.
  await page.getByRole("radio", { name: "Fail" }).click();
  await expect(okRow).toBeHidden();
  await expect(failRow).toBeVisible();

  // Text filter narrows by operation.
  await page.getByRole("radio", { name: "All" }).click();
  await page.getByPlaceholder("Filter operation / user").fill("opalrest");
  await expect(failRow).toBeVisible();
  await expect(okRow).toBeHidden();
});
