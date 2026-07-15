import { test, expect } from "@playwright/test";
import { gotoApp, dropLogFile, openApexFile } from "./fixtures";

// Cmd/Ctrl+F focuses the filter box of the pane you're in (src/focusSearch.ts).
// The shortcut resolves by walking up from the focused element, so panes with
// more than one filter must pick the one in scope — and Monaco, which has its
// own find widget, must keep the key.

const focused = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      (document.activeElement as HTMLInputElement | null)?.placeholder ??
      document.activeElement?.tagName ??
      "",
  );

test("Cmd+F focuses the log list filter", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();

  await page.keyboard.press("ControlOrMeta+f");
  expect(await focused(page)).toBe("Filter operation / user");
});

test("Cmd+F picks the filter of the pane in scope, not the first on screen", async ({
  page,
}) => {
  await gotoApp(page, {
    parse_log: {
      raw: "12:00:00.1 (1)|USER_DEBUG|[1]|DEBUG|hello",
      apiVersion: "60.0",
      units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: [] }],
    },
  });
  await page.getByRole("button", { name: "Logs" }).click();
  await dropLogFile(page, "x");

  // The log list filter comes first in the DOM; focus inside the detail pane
  // must still resolve to the raw log's own filter.
  await page.getByText("hello").click();
  await page.keyboard.press("ControlOrMeta+f");
  expect(await focused(page)).toBe("filter log…");
});

test("Cmd+F inside a Monaco editor is left to Monaco's find widget", async ({ page }) => {
  await gotoApp(page);
  await openApexFile(page);
  await page.locator(".monaco-editor").first().click();

  await page.keyboard.press("ControlOrMeta+f");
  // The Apex pane also holds a LogView filter; the shortcut must leave focus in
  // the editor rather than pull it there, so Monaco's own binding still sees F.
  const stillInEditor = await page.evaluate(
    () => !!document.activeElement?.closest(".monaco-editor"),
  );
  expect(stillInEditor).toBe(true);
});

test("Cmd+F works in a new pane after keyboard-switching away from an editor", async ({
  page,
}) => {
  await gotoApp(page);
  await openApexFile(page);
  await page.locator(".monaco-editor").first().click();

  // Cmd+3 switches to Logs, but focus stays parked in the now-hidden editor.
  // The Monaco exemption must not follow it there and kill the shortcut.
  await page.keyboard.press("ControlOrMeta+3");
  await expect(page.getByPlaceholder("Filter operation / user")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+f");
  expect(await focused(page)).toBe("Filter operation / user");
});
