import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

test("connect another org through the switcher / 通过切换器连接另一个组织", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Current org: DevHub. Switch org" }).click();
  const entry = page.getByRole("button", { name: "Connect org…" });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Connect a Salesforce org" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Log in" })).toBeVisible();
});

test("setup page still renders the shared connect form when no orgs", async ({ page }) => {
  await gotoApp(page, { list_orgs: [] });
  await expect(page.getByRole("main").getByRole("heading", { name: "Connect a Salesforce org" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});
