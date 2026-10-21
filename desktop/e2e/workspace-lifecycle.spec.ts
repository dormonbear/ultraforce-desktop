import { test, expect, type Page } from "@playwright/test";
import { installMocks } from "./fixtures";
import { MonacoEditor } from "./monaco";

const PATH = "/ws/workspace/soql/accounts.soql";
const WRITE = "plugin:fs|write_text_file";
const READ = "plugin:fs|read_text_file";

declare global {
  interface Window {
    __workspaceIO: {
      held: string[];
      calls: string[];
      picked?: string;
      waiting: {
        cmd: string;
        release: () => void;
        reject: (error: string) => void;
      }[];
    };
  }
}

/** Deferred IPC lives entirely in browser fixtures, with synthetic files only. */
async function start(page: Page, restoring = false) {
  await installMocks(page);
  await page.addInitScript(
    ({ restoring, path }) => {
      if (restoring)
        localStorage.setItem(
          "__uf_store",
          JSON.stringify({
            "tabs.soql": { openPaths: [path], activePath: path },
          }),
        );
      const io: Window["__workspaceIO"] = (window.__workspaceIO = {
        held: restoring ? ["plugin:fs|read_text_file"] : [],
        calls: [] as string[],
        waiting: [] as Window["__workspaceIO"]["waiting"],
      });
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (...args: any[]) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      const invoke = internals.invoke;
      internals.invoke = async (cmd, ...args) => {
        io.calls.push(cmd);
        const index = io.held.indexOf(cmd);
        if (index >= 0) {
          io.held.splice(index, 1);
          await new Promise<void>((release, reject) =>
            io.waiting.push({ cmd, release, reject }),
          );
        }
        if (cmd === "plugin:dialog|save" && io.picked) return io.picked;
        return invoke(cmd, ...args);
      };
    },
    { restoring, path: PATH },
  );
  await page.goto("/");
  await expect(
    page.getByRole("treeitem", { name: "accounts.soql" }),
  ).toBeVisible();
}

const hold = (page: Page, cmd: string) =>
  page.evaluate((c) => window.__workspaceIO.held.push(c), cmd);
const waiting = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => window.__workspaceIO.waiting.length))
    .toBe(1);
const release = (page: Page) =>
  page.evaluate(() => window.__workspaceIO.waiting.shift()!.release());
const disk = (page: Page, path = PATH) =>
  page.evaluate(
    (p) =>
      (
        window as unknown as { __ufReadFile: (path: string) => string | null }
      ).__ufReadFile(p),
    path,
  );

async function save(page: Page) {
  // Match Monaco's platform detection; Playwright's host OS can differ from
  // the emulated browser platform used by Desktop Chrome.
  const mac = await page.evaluate(() => /Macintosh/.test(navigator.userAgent));
  await page.keyboard.press(mac ? "Meta+s" : "Control+s");
}

test("concurrent explorer opens share a slow disk read and one tab", async ({
  page,
}) => {
  await start(page);
  await hold(page, READ);
  const file = page.getByRole("treeitem", { name: "accounts.soql" });
  await file.dblclick();
  await waiting(page);
  await release(page);
  await expect(page.getByRole("tab", { name: /accounts.soql/ })).toHaveCount(1);
  expect(
    await page.evaluate(
      (cmd) => window.__workspaceIO.calls.filter((c) => c === cmd).length,
      READ,
    ),
  ).toBe(1);
});

test("startup restore preserves a live draft and focus", async ({ page }) => {
  await start(page, true);
  await waiting(page);
  await page.getByRole("button", { name: "New query", exact: true }).click();
  const editor = new MonacoEditor(page);
  await editor.setValueViaApi("SELECT Id FROM Contact");
  await release(page);
  await expect(page.getByRole("tab", { name: /accounts.soql/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect.poll(() => editor.text()).toBe("SELECT Id FROM Contact");
});

test("newest edits survive an active slow autosave", async ({ page }) => {
  await start(page);
  await page.getByRole("treeitem", { name: "accounts.soql" }).click();
  const editor = new MonacoEditor(page);
  await hold(page, WRITE);
  await editor.setValueViaApi("SELECT Id FROM Contact");
  await waiting(page);
  await editor.setValueViaApi("SELECT Id FROM Opportunity");
  await save(page);
  await release(page);
  await expect.poll(() => disk(page)).toBe("SELECT Id FROM Opportunity");
});

test("explicit Save reports disk errors and allows retry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page.getByRole("treeitem", { name: "accounts.soql" }).click();
  const editor = new MonacoEditor(page);
  await editor.setValueViaApi("SELECT Id FROM Contact");
  await hold(page, WRITE);
  await save(page);
  await waiting(page);
  await page.evaluate(() =>
    window.__workspaceIO.waiting.shift()!.reject("Synthetic disk full"),
  );
  await expect(
    page.getByText("Synthetic disk full", { exact: true }),
  ).toBeVisible();
  await save(page);
  await expect.poll(() => disk(page)).toBe("SELECT Id FROM Contact");
  expect(errors).toEqual([]);
});

test("Save As includes edits made during the dialog and write", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("treeitem", { name: "accounts.soql" }).click();
  await page.getByRole("button", { name: "New tab" }).click();
  const editor = new MonacoEditor(page);
  await editor.setValueViaApi("SELECT Id FROM Account");
  await hold(page, "plugin:dialog|save");
  await save(page);
  await waiting(page);
  await editor.setValueViaApi("SELECT Id FROM Contact");
  await hold(page, WRITE);
  await release(page);
  await waiting(page);
  await editor.setValueViaApi("SELECT Id FROM Opportunity");
  await release(page);
  await expect
    .poll(() => disk(page, "/ws/Untitled-1.soql"))
    .toBe("SELECT Id FROM Opportunity");
});

for (const operation of ["Rename", "Delete"]) {
  test(`Save As follows concurrent ${operation} without adopting a stale path`, async ({
    page,
  }) => {
    await start(page);
    await page.getByRole("button", { name: "New query", exact: true }).click();
    const editor = new MonacoEditor(page);
    await editor.setValueViaApi("SELECT Id FROM Contact");
    await page.evaluate((path) => {
      window.__workspaceIO.picked = path;
    }, PATH);
    await hold(page, WRITE);
    await save(page);
    await waiting(page);
    await page
      .getByRole("treeitem", { name: "accounts.soql" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: operation, exact: true }).click();
    if (operation === "Rename") {
      await page.locator('input[value="accounts.soql"]').fill("renamed.soql");
      await page.keyboard.press("Enter");
    }
    await editor.setValueViaApi("SELECT Id FROM Opportunity");
    await release(page);
    await expect.poll(() => disk(page)).toBeNull();
    if (operation === "Rename") {
      await expect
        .poll(() => disk(page, "/ws/workspace/soql/renamed.soql"))
        .toBe("SELECT Id FROM Opportunity");
      await expect(
        page.getByRole("tab", { name: /renamed.soql/ }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText("File was deleted while saving. Choose another path.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("tab", { name: /Untitled/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect.poll(() => editor.text()).toBe("SELECT Id FROM Opportunity");
    }
  });

  test(`${operation} drains active saves and cannot resurrect the old path`, async ({
    page,
  }) => {
    await start(page);
    const file = page.getByRole("treeitem", { name: "accounts.soql" });
    await file.click();
    const editor = new MonacoEditor(page);
    await hold(page, WRITE);
    await editor.setValueViaApi("SELECT Id FROM Contact");
    await waiting(page);
    await file.click({ button: "right" });
    await page.getByRole("menuitem", { name: operation, exact: true }).click();
    if (operation === "Rename") {
      const rename = page.locator('input[value="accounts.soql"]');
      await rename.fill("renamed.soql");
      await page.keyboard.press("Enter");
    }
    await release(page);
    await expect.poll(() => disk(page)).toBeNull();
    if (operation === "Rename") {
      await expect
        .poll(() => disk(page, "/ws/workspace/soql/renamed.soql"))
        .toBe("SELECT Id FROM Contact");
      await expect(
        page.getByRole("tab", { name: /renamed.soql/ }),
      ).toBeVisible();
    } else
      await expect(
        page.getByRole("tab", { name: /accounts.soql/ }),
      ).toHaveCount(0);
  });
}
