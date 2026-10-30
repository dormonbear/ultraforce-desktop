import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures";

const node = {
  label: "METHOD_ENTRY", detail: "Fixture.run", startNs: 0, durNs: 1_000_000, selfNs: 1_000_000,
  children: [], source: { className: "Fixture", line: 12 },
};

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`timeline locale / 时间线语言: ${locale}`, () => {
    test.use({ locale });

    for (const empty of [true, false]) {
      test(`localizes the ${empty ? "empty" : "selected"} timeline / 本地化${empty ? "空" : "选中"}时间线`, async ({ page }) => {
        const zh = locale === "zh-CN";
        await gotoApp(page, {
          get_log: {
            raw: "67.0 APEX\nSynthetic log / 合成日志", apiVersion: "60.0",
            units: [{ tree: empty ? [] : [node], hotspots: [], statements: [], limits: [], exceptions: [] }],
          },
        });
        await page.getByRole("button", { name: zh ? "日志" : "Logs", exact: true }).click();
        await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
        await page.getByRole("radio", { name: "timeline" }).click();
        if (empty) {
          await expect(page.getByText(zh ? "无执行树" : "No execution tree")).toBeVisible();
          return;
        }
        await expect(page.getByLabel(zh ? "滚动缩放 · 拖动平移" : "Scroll to zoom · drag to pan")).toBeVisible();
        await page.locator("canvas").click({ position: { x: 20, y: 5 } });
        await expect(page.getByText(zh ? "开始 +0 ns" : "start +0 ns")).toBeVisible();
        await expect(page.getByText(zh ? "深度 0" : "depth 0")).toBeVisible();
        await page.evaluate(language => {
          Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
          window.dispatchEvent(new Event("languagechange"));
        }, zh ? "en-US" : "zh-CN");
        await expect(page.getByText(zh ? "start +0 ns" : "开始 +0 ns")).toBeVisible();
        await expect(page.getByRole("button", { name: zh ? "Open source" : "打开源码" })).toBeVisible();
        await page.getByRole("button", { name: zh ? "Reset zoom" : "重置缩放" }).click();
        await expect(page.getByText("Fixture.run")).toBeVisible();
      });
    }
  });
}
