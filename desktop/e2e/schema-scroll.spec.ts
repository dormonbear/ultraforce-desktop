import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { perfInitScript, measureClick, RAIL, schemaMockOverrides, TARGET_OBJECT, NORMAL_FIELD, PICKLIST_FIELD } from "./perf-harness";

test.use({ viewport: { width: 1440, height: 900 } });
test("schema field scroll survives repeated panel switches / 模式字段滚动位置在反复页面切换后保留", async ({ page }) => {
  await page.addInitScript(perfInitScript);
  await gotoApp(page, schemaMockOverrides());
  await page.locator(RAIL.schema).click();
  await page.getByRole("button", { name: TARGET_OBJECT }).first().click();
  const normal = page.getByRole("button", { name: NORMAL_FIELD }).first();
  await normal.waitFor();
  for (let i = 0; i < 35; i++) {
    await measureClick(page, RAIL.soql);
    await measureClick(page, RAIL.schema);
  }
  await normal.click();
  for (let i = 0; i < 35; i++) {
    await measureClick(page, RAIL.soql);
    await measureClick(page, RAIL.schema);
  }
  await normal.evaluate((el) => el.closest('[data-slot="scroll-area-viewport"]')!.setAttribute("data-owned-field-viewport", ""));
  await page.getByRole("button", { name: PICKLIST_FIELD }).first().click();
  await expect(page.getByText(/Picklist values \(1000\)/)).toBeVisible();
  const viewport = page.locator("[data-owned-field-viewport]");
  await viewport.evaluate((el) => { el.scrollTop = 235; });
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(235);
  const positions: number[] = [];
  for (let i = 0; i < 35; i++) {
    await measureClick(page, RAIL.soql);
    await measureClick(page, RAIL.schema);
    positions.push(await viewport.evaluate((el) => el.scrollTop));
  }
  expect(positions).toEqual(Array(35).fill(235));
  await normal.click();
});
