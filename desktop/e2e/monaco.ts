import { type Page, type Locator, expect } from "@playwright/test";

/**
 * Page Object for a Monaco editor instance, modeled on VS Code's smoke-test
 * `Editor` POM (microsoft/vscode test/automation/src/editor.ts): drive the
 * editor by keyboard, then assert the resulting BUFFER — not just that a widget
 * appeared. Buffer text is read from the Monaco model (exact), with EOL
 * normalized to LF and per-line trailing whitespace stripped so comparisons are
 * EOL- and render-artifact-independent.
 */
export class MonacoEditor {
  readonly root: Locator;

  constructor(
    private readonly page: Page,
    root?: Locator,
  ) {
    this.root = root ?? page.locator(".monaco-editor").first();
  }

  async focus(): Promise<void> {
    await this.root.locator(".view-lines").click();
  }

  /** Select-all then type, replacing the buffer with `text`. */
  async setText(text: string): Promise<void> {
    await this.focus();
    await this.page.keyboard.press("ControlOrMeta+a");
    await this.page.keyboard.type(text);
  }

  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text);
  }

  /** Current buffer text from the focused Monaco model (CRLF→LF, right-trimmed),
   * falling back to `.view-line` DOM if `window.monaco` is unavailable. */
  async text(): Promise<string> {
    return this.page.evaluate(() => {
      const norm = (s: string): string => {
        const lines = s.replace(/\r\n/g, "\n").split("\n");
        return lines.map((l) => l.replace(/[\t ]+$/, "")).join("\n");
      };
      const m = (window as unknown as { monaco?: any }).monaco;
      const eds = m?.editor?.getEditors?.() ?? [];
      const ed = eds.find((e: any) => e.hasTextFocus?.()) ?? eds[0];
      const val = ed?.getModel?.()?.getValue?.();
      if (typeof val === "string") return norm(val);
      const nbsp = String.fromCharCode(0xa0);
      const dom = Array.from(
        document.querySelectorAll(".monaco-editor .view-line"),
      )
        .sort(
          (a, b) =>
            parseInt((a as HTMLElement).style.top || "0") -
            parseInt((b as HTMLElement).style.top || "0"),
        )
        .map((l) => (l.textContent ?? "").split(nbsp).join(" "))
        .join("\n");
      return norm(dom);
    });
  }

  suggestWidget(): Locator {
    return this.root.locator(".suggest-widget");
  }

  /** Re-trigger completion until the suggest widget shows `label` (robust to
   * the provider not being registered the instant we type — same pattern the
   * existing suite uses). */
  async waitForSuggestion(label: string): Promise<void> {
    const item = this.suggestWidget().getByText(label, { exact: false });
    await expect(async () => {
      await this.page.keyboard.press("Control+Space");
      await expect(item).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 12000 });
  }

  /** Accept the currently selected suggestion. */
  async acceptSuggestion(): Promise<void> {
    await this.page.keyboard.press("Tab");
  }

  /** Right-click in the text area to open Monaco's context menu. */
  async openContextMenu(): Promise<Locator> {
    await this.root.locator(".view-lines").click({ button: "right" });
    const menu = this.page.locator(".monaco-menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  /** Trigger Format Document (Shift+Alt+F), retrying until the buffer changes —
   * absorbs the race where the formatter provider registers on editor mount
   * just after the file opens. (Our format mocks always return changed text.) */
  async formatDocument(): Promise<void> {
    await this.focus();
    const before = await this.text();
    await expect(async () => {
      await this.page.keyboard.press("Shift+Alt+F");
      await expect.poll(() => this.text(), { timeout: 1500 }).not.toBe(before);
    }).toPass({ timeout: 12000 });
  }
}
