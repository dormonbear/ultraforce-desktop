import { test, expect, type Page } from "@playwright/test";
import { installMocks } from "./fixtures";
import { MonacoEditor } from "./monaco";

/** Synthetic Windows filesystem boundary; deliberately independent of app helpers. */
async function start(page: Page, appData: string, override: boolean) {
  await installMocks(page);
  await page.addInitScript(
    ({ appData, override }) => {
      const root = override ? appData + "custom" : appData + "workspace\\soql";
      const key = "__windows_files";
      const files: Record<string, string> = JSON.parse(
        localStorage.getItem(key) ?? "null",
      ) ?? {
        [root + "\\accounts.soql"]: "SELECT Id FROM Account",
        [root + "\\nested\\child.soql"]: "SELECT Id FROM Contact",
      };
      const persist = () => localStorage.setItem(key, JSON.stringify(files));
      if (override) {
        const store = JSON.parse(localStorage.getItem("__uf_store") ?? "{}");
        store["workspace.soql.path"] = root + "\\";
        localStorage.setItem("__uf_store", JSON.stringify(store));
      }
      const internals = (window as any).__TAURI_INTERNALS__;
      const invoke = internals.invoke;
      (window as any).__windowsDisk = files;
      const normalize = (p: string) => {
        if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(p))
          throw new Error(
            "Synthetic filesystem rejected malformed Windows path",
          );
        return p.replace(/\//g, "\\").replace(/\\+$/, "");
      };
      const readDirectory = (path: string) => {
        const entries = new Map<string, boolean>();
        for (const file of Object.keys(files)) {
          if (!file.startsWith(path + "\\")) continue;
          const parts = file.slice(path.length + 1).split("\\");
          entries.set(parts[0], parts.length > 1);
        }
        return [...entries].map(([name, isDirectory]) => ({
          name,
          isDirectory,
          isFile: !isDirectory,
          isSymlink: false,
        }));
      };
      const changeFiles = (path: string, to: string | null) => {
        for (const [file, content] of Object.entries(files)) {
          if (file !== path && !file.startsWith(path + "\\")) continue;
          delete files[file];
          if (to) files[to + file.slice(path.length)] = content;
        }
      };
      const operations: Record<string, (path: string, args: any) => unknown> = {
        "plugin:fs|exists": () => true,
        "plugin:fs|mkdir": () => null,
        "plugin:fs|read_dir": readDirectory,
        "plugin:fs|read_text_file": (path) => {
          if (!(path in files)) throw new Error("Synthetic file missing");
          return [...new TextEncoder().encode(files[path])];
        },
        "plugin:fs|write_text_file": (path, args) => {
          files[path] = new TextDecoder().decode(new Uint8Array(args));
          persist();
        },
        "plugin:fs|rename": (path, args) => {
          changeFiles(path, normalize(args.newPath));
          persist();
        },
        "plugin:fs|remove": (path) => {
          changeFiles(path, null);
          persist();
        },
      };
      internals.invoke = async (cmd: string, args: any = {}, opts?: any) => {
        if (cmd.startsWith("plugin:path|")) return appData;
        if (cmd === "plugin:dialog|save") return root + "\\draft.soql";
        if (!cmd.startsWith("plugin:fs|")) return invoke(cmd, args, opts);
        const path = normalize(
          opts?.headers?.path
            ? decodeURIComponent(opts.headers.path)
            : (args.oldPath ?? args.path),
        );
        const operation = operations[cmd];
        if (!operation)
          throw new Error("Unexpected synthetic filesystem command");
        return operation(path, args);
      };
    },
    { appData, override },
  );
  await page.goto("/");
  await expect(
    page.getByRole("treeitem", { name: "accounts.soql" }),
  ).toBeVisible();
}

for (const [kind, appData, override] of [
  ["drive appData", "C:\\Users\\fixture\\AppData\\Roaming\\tool\\", false],
  ["UNC dialog override", "\\\\server\\share\\tool\\", true],
] as const) {
  test(`${kind}: explore, rename, save draft and restore`, async ({ page }) => {
    await start(page, appData, override);
    const root = override ? appData + "custom" : appData + "workspace\\soql";
    await page.getByRole("treeitem", { name: "accounts.soql" }).click();
    const editor = new MonacoEditor(page);
    await expect.poll(() => editor.text()).toBe("SELECT Id FROM Account");
    await page
      .getByRole("treeitem", { name: "accounts.soql" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await page.locator('input[value="accounts.soql"]').fill("renamed.soql");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: /renamed.soql/ })).toBeVisible();
    // Repeated handoffs expose delayed menu cleanup between folder renames. / 重复交接暴露目录重命名之间迟到的菜单清理。
    for (let cycle = 0; cycle < 3; cycle++) {
      const from = cycle % 2 === 0 ? "nested" : "archive";
      const to = cycle % 2 === 0 ? "archive" : "nested";
      const folder = page.getByRole("treeitem", { name: from, exact: true });
      if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
      await page.getByRole("treeitem", { name: "child.soql" }).click();
      await editor.setValueViaApi("SELECT Name FROM Contact");
      await page
        .getByRole("treeitem", { name: from, exact: true })
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      await page.locator(`input[value="${from}"]`).fill(to);
      await page.keyboard.press("Enter");
      await expect
        .poll(() =>
          page.evaluate(
            (p) => (window as any).__windowsDisk[p],
            root + "\\" + to + "\\child.soql",
          ),
        )
        .toBe("SELECT Name FROM Contact");
      await expect
        .poll(() =>
          page.evaluate(
            (p) => (window as any).__windowsDisk[p] ?? null,
            root + "\\" + from + "\\child.soql",
          ),
        )
        .toBeNull();
    }
    await editor.setValueViaApi("SELECT Id, Name FROM Contact");
    await page
      .getByRole("treeitem", { name: "archive", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("tab", { name: /child.soql/ })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          (p) => (window as any).__windowsDisk[p] ?? null,
          root + "\\archive\\child.soql",
        ),
      )
      .toBeNull();
    await editor.setValueViaApi("SELECT Name FROM Account");
    await expect
      .poll(() =>
        page.evaluate(
          (p) => (window as any).__windowsDisk[p],
          root + "\\renamed.soql",
        ),
      )
      .toBe("SELECT Name FROM Account");
    await page.getByRole("button", { name: "New tab" }).click();
    await editor.setValueViaApi("SELECT Id FROM Opportunity");
    const mac = await page.evaluate(() =>
      /Macintosh/.test(navigator.userAgent),
    );
    await page.keyboard.press(mac ? "Meta+s" : "Control+s");
    await expect(page.getByRole("tab", { name: /draft.soql/ })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (p) => (window as any).__windowsDisk[p],
          root + "\\draft.soql",
        ),
      )
      .toBe("SELECT Id FROM Opportunity");
    await page.reload();
    await expect(page.getByRole("tab", { name: /draft.soql/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect.poll(() => editor.text()).toBe("SELECT Id FROM Opportunity");
    await expect(page.getByRole("tab", { name: /renamed.soql/ })).toBeVisible();
  });
}
