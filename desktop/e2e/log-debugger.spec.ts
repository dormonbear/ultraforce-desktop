import { test, expect } from "@playwright/test";
import { gotoApp, dropLogFile } from "./fixtures";

// A minimal parsed view so the Logs detail (and its Debug button) renders.
const VIEW = {
  raw: "67.0 APEX\nx\ny",
  apiVersion: "60.0",
  raw_sources: [],
  units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: [] }],
};

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

test("steps through the outline, showing call stack and variables", async ({ page }) => {
  await openDebugger(page, OUTLINE, FRAMES);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("step 1/2");
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
  // Call stack + variables come from debug_frames_at.
  await expect(dialog.getByText("MyClass.run()")).toBeVisible();
  await expect(dialog.getByText("x (Integer) = 1")).toBeVisible();

  // Stepping forward advances the playhead.
  await dialog.getByRole("button", { name: "Step", exact: true }).click();
  await expect(dialog.getByRole("heading")).toContainText("step 2/2");
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
