import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

test("connect another org: dropdown entry opens the dialog", async ({ page }) => {
  await gotoApp(page);
  await page.getByLabel("Select Salesforce org").click();
  const entry = page.getByText("Connect another org…");
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(
    page.getByRole("dialog").getByText("Connect a Salesforce org"),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Log in" })).toBeVisible();
});

test("setup page still renders the shared connect form when no orgs", async ({ page }) => {
  await gotoApp(page, { list_orgs: [] });
  await expect(page.getByText("Connect a Salesforce org")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});
