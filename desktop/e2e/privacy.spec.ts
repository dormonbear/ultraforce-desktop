import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

test("editor and fonts load locally with external requests blocked", async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      external.push(url.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await gotoApp(page);
  await page.getByText("accounts.soql").first().click();
  expect(external).toEqual([]);
  await expect.poll(async () => ({ errors, editors: await page.locator(".monaco-editor").count() })).toEqual({ errors: [], editors: 1 });
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  expect(external).toEqual([]);
});
