import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

// No org + a non-ok `sf` CLI status → the setup area shows CLI guidance.

test("not_found → install guidance", async ({ page }) => {
  await gotoApp(page, {
    list_orgs: [],
    sf_status: {
      state: "not_found",
      version: null,
      minVersion: "2.0.0",
      foundAt: null,
    },
  });
  await expect(page.getByText("Salesforce CLI not found")).toBeVisible();
  await expect(page.getByText("npm install -g @salesforce/cli")).toBeVisible();
});

test("outdated → upgrade guidance", async ({ page }) => {
  await gotoApp(page, {
    list_orgs: [],
    sf_status: {
      state: "outdated",
      version: "@salesforce/cli/1.9.0",
      minVersion: "2.0.0",
      foundAt: null,
    },
  });
  await expect(page.getByText("Salesforce CLI is too old")).toBeVisible();
  await expect(page.getByText(/2\.0\.0 or newer/)).toBeVisible();
  await expect(page.getByText("npm update -g @salesforce/cli")).toBeVisible();
});

test("path_issue → PATH guidance naming where sf was found", async ({ page }) => {
  await gotoApp(page, {
    list_orgs: [],
    sf_status: {
      state: "path_issue",
      version: null,
      minVersion: "2.0.0",
      foundAt: "/opt/homebrew/bin/sf",
    },
  });
  await expect(page.getByText(/not on this app.s PATH/)).toBeVisible();
  await expect(page.getByText("/opt/homebrew/bin/sf")).toBeVisible();
});

test("ok status with no orgs → connect form, not CLI guidance", async ({
  page,
}) => {
  await gotoApp(page, { list_orgs: [] });
  await expect(page.getByText("Connect a Salesforce org")).toBeVisible();
  await expect(page.getByText("Salesforce CLI not found")).toHaveCount(0);
});
