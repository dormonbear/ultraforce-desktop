import { test, expect } from "@playwright/test";
import { installMocks } from "./fixtures";
import { MonacoEditor } from "./monaco";

for (const candidates of [[], [{ label: "NativeService", kind: "type" }]]) {
  test(`fresh Apex retains native keyboard input with ${candidates.length} candidates / 新建 Apex 在 ${candidates.length} 个候选项时保留原生键盘输入`, async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", message => {
      if (message.text().includes("flushSync")) warnings.push(message.text());
    });
    await installMocks(page, { apex_complete: candidates });
    await page.goto("/");
    const mac = await page.evaluate(() => /Macintosh/.test(navigator.userAgent));
    await page.getByRole("button", { name: "Apex", exact: true }).click();
    await page.getByRole("button", { name: "New script", exact: true }).click();
    const editor = new MonacoEditor(page, page.locator(".monaco-editor:visible"));
    await editor.focus();
    await page.keyboard.type("NativeService.");
    await expect.poll(() => editor.text()).toBe("NativeService.");
    for (const text of ["NativeService.run", "NativeService.", "NativeService.run"]) {
      await page.keyboard.press(mac ? "Meta+a" : "Control+a");
      await page.keyboard.type(text);
      await expect.poll(() => editor.text()).toBe(text);
    }
    const before = "NativeService.run";
    for (let index = 0; index < before.length - 7; index++) {
      await page.keyboard.press("ArrowLeft");
    }
    await page.keyboard.type("XYZ");
    await expect.poll(() => editor.text()).toBe(before.slice(0, 7) + "XYZ" + before.slice(7));
    expect(warnings).toEqual([]);
  });
}
