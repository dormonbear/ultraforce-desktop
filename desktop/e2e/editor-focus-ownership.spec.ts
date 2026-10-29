import { expect, test, type Page } from "@playwright/test";
import { installMocks } from "./fixtures";

type FocusHarness = { waiting: boolean; release?: () => void; mkdir: unknown[] };
type Scope = { __editorFocus: FocusHarness; __ufCalls: { cmd: string }[] };
const cases = [
  { panel: "SOQL", file: "accounts.soql", path: "/ws/workspace/soql/accounts.soql", diagnostics: "soql_diagnostics", newLabel: "New query" },
  { panel: "Apex", file: "hello.apex", path: "/ws/workspace/apex/hello.apex", diagnostics: "apex_soql_diagnostics", newLabel: "New script" },
] as const;

async function start(page: Page, item: (typeof cases)[number], hold = true) {
  await installMocks(page);
  await page.addInitScript(({ target, holdRead }) => {
    const scope = window as unknown as Scope & { __TAURI_INTERNALS__: { invoke: (cmd: string, ...args: unknown[]) => Promise<unknown> } };
    const state: FocusHarness = scope.__editorFocus = { waiting: false, mkdir: [] };
    const invoke = scope.__TAURI_INTERNALS__.invoke;
    scope.__TAURI_INTERNALS__.invoke = async (cmd, ...args) => {
      if (cmd === "plugin:fs|mkdir") state.mkdir.push(args[0]);
      const payload = args[0] as { path?: string } | undefined;
      if (holdRead && (cmd === "plugin:fs|read_text_file" || cmd === "plugin:fs|read_file") && payload?.path === target) {
        state.waiting = true;
        await new Promise<void>((resolve) => { state.release = resolve; });
        state.waiting = false;
      }
      return invoke(cmd, ...args);
    };
  }, { target: item.path, holdRead: hold });
  await page.goto("/");
  if (item.panel === "Apex") await page.getByRole("button", { name: "Apex", exact: true }).click();
  const file = page.getByRole("treeitem", { name: item.file });
  await expect(file).toBeVisible();
  await file.click();
  if (hold) await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__editorFocus.waiting)).toBe(true);
}

async function waitForEditor(page: Page, diagnostics: string) {
  await expect.poll(() => page.evaluate((cmd) => (window as unknown as Scope).__ufCalls.some((call) => call.cmd === cmd), diagnostics)).toBe(true);
}

async function release(page: Page, diagnostics: string) {
  await page.evaluate(() => (window as unknown as Scope).__editorFocus.release?.());
  await waitForEditor(page, diagnostics);
}

for (const item of cases) test.describe(item.panel, () => {
  test.use({ locale: "en-US" });

  test("focuses a newly opened editor when the user has not moved focus / 用户未移动焦点时聚焦新编辑器", async ({ page }) => {
    await start(page, item);
    await release(page, item.diagnostics);
    await expect(page.getByRole("textbox", { name: "Editor content" })).toBeFocused();
  });

  test("focuses a newly created editor / 聚焦新建编辑器", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    if (item.panel === "Apex") await page.getByRole("button", { name: "Apex", exact: true }).click();
    await page.getByRole("button", { name: item.newLabel, exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Editor content" })).toBeFocused();
  });

  test("preserves a newer folder edit without creating it / 保留后续文件夹编辑且不意外创建", async ({ page }) => {
    await start(page, item);
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    const input = page.getByPlaceholder("folder name");
    await input.fill("archive");
    await expect(input).toBeFocused();
    await release(page, item.diagnostics);
    await expect(input).toHaveValue("archive");
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as Scope).__editorFocus.mkdir)).toEqual([]);
  });

  test("preserves a newer toolbar focus / 保留后续工具栏焦点", async ({ page }) => {
    await start(page, item);
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await refresh.click();
    await expect(refresh).toBeFocused();
    await release(page, item.diagnostics);
    await expect(refresh).toBeFocused();
  });

  test("keeps an immediate folder edit during an ordinary open / 普通打开时保留立即开始的文件夹编辑", async ({ page }) => {
    await start(page, item, false);
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    const input = page.getByPlaceholder("folder name");
    await input.fill("archive");
    await waitForEditor(page, item.diagnostics);
    await expect(input).toHaveValue("archive");
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as Scope).__editorFocus.mkdir)).toEqual([]);
  });
});
