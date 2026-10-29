import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gotoApp } from "./fixtures";
import { MonacoEditor } from "./monaco";
import { documentationArtifactPath } from "./documentation-artifact-path.mjs";

/**
 * Capture README screenshots in test output; update docs with `pnpm exec playwright test screenshots -u`.
 * 将 README 截图保存到测试输出；使用 `pnpm exec playwright test screenshots -u` 更新文档。
 */

const OUT = fileURLToPath(new URL("../../docs/images/", import.meta.url));
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

test("soql panel with results", async ({ page }, testInfo) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  const ed = new MonacoEditor(page);
  await ed.setValueViaApi("SELECT Id, Name, Industry FROM Account LIMIT 12");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/rows returned/)).toBeVisible();
  // Drop editor focus + park the cursor off-canvas so neither the blinking
  // caret nor a hover row-highlight is in the shot.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
  await page.mouse.move(1400, 880);
  await page.waitForTimeout(400);
  await page.screenshot({ path: documentationArtifactPath(testInfo, join(OUT, "soql.png"), "soql.png") });
});

test("apex panel with debug log", async ({ page }, testInfo) => {
  await gotoApp(page);
  await page.getByLabel("Apex").click();
  await page.getByText("hello.apex").click();
  const ed = new MonacoEditor(page);
  await ed.setValueViaApi("System.debug('Hello, Ultraforce');");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText("COMPILED")).toBeVisible();
  await expect(page.getByText(/USER_DEBUG/).first()).toBeVisible();
  await page.getByText("DEBUG LOG", { exact: false }).first().hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: documentationArtifactPath(testInfo, join(OUT, "apex.png"), "apex.png") });
});

test("soql completion dropdown", async ({ page }, testInfo) => {
  await gotoApp(page);
  await page.getByText("accounts.soql").click();
  const ed = new MonacoEditor(page);
  await ed.setValueViaApi("SELECT Id, ");
  await ed.waitForSuggestion("Name");
  await page.waitForTimeout(300);
  await page.screenshot({ path: documentationArtifactPath(testInfo, join(OUT, "completion.png"), "completion.png") });
});
