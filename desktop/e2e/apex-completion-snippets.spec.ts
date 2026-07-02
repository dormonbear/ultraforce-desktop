import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";
import { MonacoEditor } from "./monaco";

/** Editor-UX e2e for completion maturity: placeholder-arg call snippets,
 * the statement-position semicolon, quote auto-closing, and keyword block
 * snippets. Deterministic candidates come from the mocked IPC (fixtures.ts);
 * what's under test is the buffer Monaco produces after accepting. */

async function openApex(page: import("@playwright/test").Page): Promise<MonacoEditor> {
  await page.getByLabel("Apex").click();
  await page.getByText("hello.apex").click();
  return new MonacoEditor(page);
}

const DEBUG_METHOD = [{ label: "debug", kind: "method", detail: "void", params: ["Object"] }];

test("accepting a void method in statement position inserts args and semicolon", async ({ page }) => {
  await gotoApp(page, { apex_complete: DEBUG_METHOD });
  const editor = await openApex(page);

  await editor.setValueViaApi("System.de");
  await editor.waitForSuggestion("debug");
  await editor.acceptSuggestion();

  await expect.poll(() => editor.text()).toContain("System.debug(Object);");
});

test("accepting a no-arg non-void method inserts empty parens without semicolon", async ({ page }) => {
  await gotoApp(page, {
    apex_complete: [{ label: "now", kind: "method", detail: "Datetime", params: [] }],
  });
  const editor = await openApex(page);

  await editor.setValueViaApi("Datetime.n");
  await editor.waitForSuggestion("now");
  await editor.acceptSuggestion();

  const text = await editor.text();
  expect(text).toContain("Datetime.now()");
  expect(text).not.toContain(";");
});

test("existing call parens are not duplicated", async ({ page }) => {
  await gotoApp(page, { apex_complete: DEBUG_METHOD });
  const editor = await openApex(page);

  await editor.setValueViaApi("System.de()");
  // Park the caret between "de" and "(".
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await editor.waitForSuggestion("debug");
  await editor.acceptSuggestion();

  const text = await editor.text();
  expect(text).toContain("System.debug()");
  expect(text).not.toContain("((");
  expect(text).not.toContain("))");
});

test("typing a single quote auto-closes the pair", async ({ page }) => {
  await gotoApp(page);
  const editor = await openApex(page);

  await editor.setText("String s = ");
  await editor.type("'");

  await expect.poll(() => editor.text()).toContain("''");
});

test("accepting the if keyword block snippet inserts a body", async ({ page }) => {
  await gotoApp(page, { apex_complete: [{ label: "if", kind: "keyword" }] });
  const editor = await openApex(page);

  await editor.setText("if");
  await editor.waitForSuggestion("if block");
  await editor.acceptSuggestion();

  await expect.poll(() => editor.text()).toContain("if () {");
});
