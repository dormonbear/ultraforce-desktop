import { test, expect } from "@playwright/test";
import { gotoApp, dropLogFile } from "./fixtures";
import type { LogViewDto } from "../src/types";

// A minimal parsed view so the Logs detail (and its Debug button) renders.
const VIEW = {
  apiVersion: "60.0",
  units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: [] }],
} satisfies Omit<LogViewDto, "raw">;

const SOURCE = {
  name: "MyClass",
  kind: "class",
  body: Array.from({ length: 12 }, (_, i) => `// line ${i + 1}`).join("\n"),
};

// Lightweight outline: two stop points, same call depth.
const OUTLINE = {
  steps: [
    { unitIndex: 0, entryIndex: 2, source: { className: "MyClass", line: 5 }, depth: 2, isFrameStart: true },
    { unitIndex: 0, entryIndex: 5, source: { className: "MyClass", line: 8 }, depth: 2, isFrameStart: false },
  ],
  hasVariables: true,
};

// Call stack fetched per step (debug_frames_at). The mock returns this for any
// step; per-step variable changes are unit-tested in Rust (frames_at).
const FRAMES = [
  { className: "MyClass", line: null, signature: "MyClass.run()", variables: [] },
  {
    className: "MyClass",
    line: 8,
    signature: "MyClass.doWork()",
    variables: [{ name: "x", typeName: "Integer", value: "1" }],
  },
];

async function openDebugger(
  page: import("@playwright/test").Page,
  outline: unknown,
  frames: unknown,
) {
  await gotoApp(page, {
    parse_log: VIEW,
    debug_session: outline,
    debug_frames_at: frames,
    fetch_apex_source: SOURCE,
  });
  await page.getByRole("button", { name: "Logs" }).click();
  await dropLogFile(page);
  await page.getByRole("button", { name: "Debug" }).click();
}

test("steps through the outline, showing call stack and variables / 遍历大纲并显示调用栈及变量", async ({ page }) => {
  await openDebugger(page, OUTLINE, FRAMES);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Debug", exact: true })).toBeVisible();
  await expect(dialog.getByText(/step 1\/2/)).toBeVisible();
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
  // Call stack + variables come from debug_frames_at.
  await expect(dialog.getByText("MyClass.run()")).toBeVisible();
  await expect(dialog.getByText("x (Integer) = 1")).toBeVisible();

  // Stepping forward advances the playhead.
  await dialog.getByRole("button", { name: "Step", exact: true }).click();
  await expect(dialog.getByText(/step 2\/2/)).toBeVisible();
});

test("shows a FINEST hint when the log carries no variable data", async ({ page }) => {
  const noVars = {
    steps: [
      { unitIndex: 0, entryIndex: 2, source: { className: "MyClass", line: 5 }, depth: 1, isFrameStart: true },
    ],
    hasVariables: false,
  };
  const bareFrames = [
    { className: "MyClass", line: 5, signature: "MyClass.doWork()", variables: [] },
  ];
  await openDebugger(page, noVars, bareFrames);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/APEX_CODE=FINEST/)).toBeVisible();
});

for (const locale of ["en-US", "zh-CN"] as const) {
  test.describe(`debugger locale / 调试器语言: ${locale}`, () => {
    test.use({ locale });

    test("localizes controls while preserving the selected step / 本地化控件并保留当前步骤", async ({ page }) => {
      const zh = locale === "zh-CN";
      await gotoApp(page, {
        parse_log: VIEW,
        debug_session: OUTLINE,
        debug_frames_at: FRAMES,
        fetch_apex_source: SOURCE,
      });
      await page.getByRole("button", { name: zh ? "日志" : "Logs", exact: true }).click();
      await dropLogFile(page);
      await page.getByRole("button", { name: zh ? "调试" : "Debug", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: zh ? "调试" : "Debug", exact: true })).toBeVisible();
      await expect(dialog.getByText(zh ? "调用堆栈" : "Call stack", { exact: true })).toBeVisible();
      await expect(dialog.getByText(zh ? "变量" : "Variables", { exact: true })).toBeVisible();
      await expect(dialog.getByText("x (Integer) = 1")).toBeVisible();
      await dialog.getByRole("button", { name: zh ? "单步进入" : "Step", exact: true }).click();
      await expect(dialog.getByText(zh ? /第 2\/2 步/ : /step 2\/2/)).toBeVisible();
      await page.evaluate(language => {
        Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
        window.dispatchEvent(new Event("languagechange"));
      }, zh ? "en-US" : "zh-CN");
      await expect(dialog.getByText(zh ? "Call stack" : "调用堆栈", { exact: true })).toBeVisible();
      await expect(dialog.getByText(zh ? /step 2\/2/ : /第 2\/2 步/)).toBeVisible();
      await expect(dialog.getByText("x (Integer) = 1")).toBeVisible();
      await dialog.getByRole("button", { name: zh ? "Close" : "关闭", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    });
  });
}
