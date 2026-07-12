import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { gotoApp } from "./fixtures";
import {
  perfInitScript,
  measureClick,
  measureFirstShow,
  domNodes,
  resetPerf,
  snapshotPerf,
  RAIL,
  summarize,
  type Sample,
  type SeriesStats,
  type FirstShowSample,
  schemaMockOverrides,
  TARGET_OBJECT,
  NORMAL_FIELD,
  PICKLIST_FIELD,
} from "./perf-harness";

/**
 * Step 1 of the page-switch perf plan (docs/superpowers/plans/2026-07-11-page-switch-perf.md).
 *
 * A repeatable measurement harness for page (rail) switching. Fixed viewport,
 * fixed mock data (2000 objects / 800 fields / one field with 1000 picklist
 * values). Per scenario: 5 warmup iterations, then ≥30 samples; reports P50/P95.
 * This is a MEASUREMENT harness — it asserts sanity only (samples collected,
 * metrics finite/non-zero), not a pass/fail perf gate.
 *
 * Runs in isolation regardless of the pre-existing failing e2e specs:
 *   pnpm exec playwright test e2e/page-switch-perf.spec.ts --workers=1
 */

// Fixed viewport for deterministic layout/paint cost.
test.use({ viewport: { width: 1440, height: 900 } });

const WARMUP = 5;
const SAMPLES = 30;

// Collected across all tests (workers=1 → single process); written to the
// baseline doc in afterAll.
const results: SeriesStats[] = [];

// PERF_PROD=1 runs against a minified `vite preview` build; write its numbers to
// a separate file so the acceptance-gate run never clobbers the dev baseline.
const PROD = !!process.env.PERF_PROD;
const BASELINE_PATH = PROD
  ? "../../docs/superpowers/plans/2026-07-11-page-switch-perf-baseline-prod.md"
  : "../../docs/superpowers/plans/2026-07-11-page-switch-perf-baseline.md";

async function boot(page: Page): Promise<void> {
  await page.addInitScript(perfInitScript);
  await gotoApp(page, schemaMockOverrides());
  await page.locator(RAIL.schema).first().waitFor({ state: "visible" });
  await resetPerf(page);
}

async function settleAfterReload(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.locator(RAIL.schema).first().waitFor({ state: "visible" });
}

/** Measure a hot A↔B switch pair. Precondition: app is on `backSel`. Returns
 * per-direction samples with the warmup iterations discarded. */
async function measureHotPair(
  page: Page,
  fwdSel: string,
  backSel: string,
): Promise<{ fwd: Sample[]; back: Sample[] }> {
  const fwd: Sample[] = [];
  const back: Sample[] = [];
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    const a = await measureClick(page, fwdSel);
    const b = await measureClick(page, backSel);
    if (i >= WARMUP) {
      fwd.push(a);
      back.push(b);
    }
  }
  return { fwd, back };
}

/** Sanity assertions shared by every scenario. */
function assertSane(stats: SeriesStats): void {
  expect(stats.n).toBeGreaterThanOrEqual(SAMPLES);
  expect(Number.isFinite(stats.p50)).toBe(true);
  expect(Number.isFinite(stats.p95)).toBe(true);
  expect(stats.p50).toBeGreaterThan(0);
}

// ── Scenario B: hot SOQL ↔ Schema (both directions) ──────────────────────────
test("hot switch SOQL ↔ Schema", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);

  const { fwd, back } = await measureHotPair(page, RAIL.schema, RAIL.soql);
  // App ends on SOQL; re-enter Schema to snapshot its DOM size.
  await measureClick(page, RAIL.schema);
  const dom = await domNodes(page);

  const enter = summarize("Hot SOQL→Schema", fwd, dom);
  const exit = summarize("Hot Schema→SOQL", back);
  results.push(enter, exit);
  assertSane(enter);
  assertSane(exit);
  expect(dom).toBeGreaterThan(0);
});

// ── Scenario A: cold first entry into Schema (reload per sample) ──────────────
test("cold first entry into Schema", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);

  const samples: Sample[] = [];
  let dom = 0;
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    await page.reload();
    await settleAfterReload(page);
    const s = await measureClick(page, RAIL.schema);
    if (i >= WARMUP) {
      samples.push(s);
      dom = await domNodes(page);
    }
  }
  const stats = summarize("Cold first-entry Schema", samples, dom);
  results.push(stats);
  assertSane(stats);
});

// ── Scenario C: Schema states (no field / normal / large picklist / refs) ─────
test("Schema states: field-selection variants", async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page);

  // Prime Schema and select the target object once (detail is cached).
  await page.locator(RAIL.schema).click();
  await page.getByRole("button", { name: TARGET_OBJECT }).first().click();
  await page.getByRole("button", { name: NORMAL_FIELD }).first().waitFor();

  type StateSetup = { name: string; setup: () => Promise<void> };
  const states: StateSetup[] = [
    {
      name: "Schema · no field selected",
      setup: async () => {
        // Object selected, no field → right pane shows record types.
        const close = page.getByRole("button", { name: "Close field detail" });
        if (await close.isVisible().catch(() => false)) await close.click();
      },
    },
    {
      name: "Schema · normal field selected",
      setup: async () => {
        await page.getByRole("button", { name: NORMAL_FIELD }).first().click();
      },
    },
    {
      name: "Schema · large-picklist field (1000 values)",
      setup: async () => {
        await page.getByRole("button", { name: PICKLIST_FIELD }).first().click();
        await expect(page.getByText(/Picklist values \(1000\)/)).toBeVisible();
      },
    },
    {
      name: "Schema · many references expanded (300)",
      setup: async () => {
        await page.getByRole("button", { name: NORMAL_FIELD }).first().click();
        await page.getByRole("button", { name: "Where is this used?" }).click();
        await expect(page.getByText("Component_0000")).toBeVisible();
      },
    },
  ];

  for (const st of states) {
    // Ensure Schema active for setup + DOM snapshot.
    await page.locator(RAIL.schema).click();
    await st.setup();
    const dom = await domNodes(page);
    // Return to SOQL, then measure hot re-entry into Schema with this state.
    await page.locator(RAIL.soql).click();
    const { fwd } = await measureHotPair(page, RAIL.schema, RAIL.soql);
    const stats = summarize(st.name, fwd, dom);
    results.push(stats);
    assertSane(stats);
    expect(dom).toBeGreaterThan(0);
  }
});

// ── Scenario D1: hot SOQL ↔ Logs ─────────────────────────────────────────────
test("hot switch SOQL ↔ Logs", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);

  const { fwd, back } = await measureHotPair(page, RAIL.logs, RAIL.soql);
  await measureClick(page, RAIL.logs);
  const dom = await domNodes(page);

  const enter = summarize("Hot SOQL→Logs", fwd, dom);
  const exit = summarize("Hot Logs→SOQL", back);
  results.push(enter, exit);
  assertSane(enter);
  assertSane(exit);
});

// ── Scenario D2: cold first entry into Logs ──────────────────────────────────
test("cold first entry into Logs", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);

  const samples: Sample[] = [];
  let dom = 0;
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    await page.reload();
    await settleAfterReload(page);
    const s = await measureClick(page, RAIL.logs);
    if (i >= WARMUP) {
      samples.push(s);
      dom = await domNodes(page);
    }
  }
  const stats = summarize("Cold first-entry Logs", samples, dom);
  results.push(stats);
  assertSane(stats);
});

// ── Scenario D3: Logs with a large log detail open, switch in/out ─────────────
test("hot switch with large log detail open", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);

  await page.locator(RAIL.logs).click();
  // Select the first log row → detail loads via the large get_log mock.
  await page.locator("button", { hasText: "/services/data" }).first().click();
  await expect(page.getByText(/^Log detail/)).toBeVisible();
  const dom = await domNodes(page);

  await page.locator(RAIL.soql).click();
  const { fwd, back } = await measureHotPair(page, RAIL.logs, RAIL.soql);

  const enter = summarize("Logs (big detail) SOQL→Logs", fwd, dom);
  const exit = summarize("Logs (big detail) Logs→SOQL", back);
  results.push(enter, exit);
  assertSane(enter);
  assertSane(exit);
  expect(dom).toBeGreaterThan(0);
});

// ── Scenario E (Step 6): preheat hidden-mount → first show into Schema ────────
// With the org's index reported ready, App idle-preheats the (hidden) Schema
// panel. We start on SOQL, wait for that hidden mount, then measure the first
// click→paint into Schema — the display:none virtualizer case. Reload per sample
// so each measures a freshly preheated (still hidden) panel.
const READY_INDEX = {
  org: "dev@acme.com",
  state: "ready",
  phase: null,
  done: null,
  total: null,
  lastIndexed: 1_700_000_000_000,
  error: null,
};
const HIDDEN_SCHEMA = 'input[aria-label="Search schema"]';
const OBJECT_ROWS = "button[data-index]";

async function bootPreheat(page: Page): Promise<void> {
  await page.addInitScript(perfInitScript);
  await gotoApp(page, { ...schemaMockOverrides(), index_status: READY_INDEX });
  await page.locator(RAIL.schema).first().waitFor({ state: "visible" });
}

test("preheat: hidden-mount → first show into Schema", async ({ page }) => {
  test.setTimeout(180_000);
  await bootPreheat(page);

  // The hidden Schema panel is attached (but not visible) once preheat mounts it.
  await page.locator(HIDDEN_SCHEMA).waitFor({ state: "attached", timeout: 10_000 });
  // The measured panel must NOT be the active one yet (still on SOQL).
  await expect(page.locator(HIDDEN_SCHEMA)).toBeHidden();

  // Long-task load of a boot that DOES preheat (boot + hidden SchemaPanel mount).
  // perfInitScript resets __perf per navigation, so this window is this boot only.
  const sumLT = (ts: { dur: number }[]) =>
    Math.round(ts.filter((t) => t.dur > 50).reduce((m, t) => m + t.dur, 0));
  const readyBootLT = sumLT((await snapshotPerf(page)).longTasks);

  const samples: FirstShowSample[] = [];
  let dom = 0;
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    if (i > 0) {
      await page.reload();
      await settleAfterReload(page);
      await page.locator(HIDDEN_SCHEMA).waitFor({ state: "attached", timeout: 10_000 });
    }
    await resetPerf(page);
    const s = await measureFirstShow(page, RAIL.schema, OBJECT_ROWS);
    if (i >= WARMUP) {
      samples.push(s);
      dom = await domNodes(page);
    }
  }

  const stats = summarize("Preheat first-show Schema", samples, dom);
  results.push(stats);
  assertSane(stats);

  // Blank-frame verdict: a blank frame is any sample that painted zero object
  // rows on the first frame yet had rows once settled.
  const blank = samples.filter(
    (s) => s.rowsAtFirstPaint === 0 && s.rowsSettled > 0,
  ).length;
  const minFirst = Math.min(...samples.map((s) => s.rowsAtFirstPaint));
  const minSettled = Math.min(...samples.map((s) => s.rowsSettled));

  // Gating + SOQL long-task isolation: reboot with the index reported *idle* (not
  // ready). Preheat must hold — the hidden Schema panel must NOT mount — so this
  // boot's long-task load is the app baseline. The preheat-mount cost on the SOQL
  // page is the ready-vs-idle boot delta, not the raw ready number (which also
  // includes app boot: Monaco, first render).
  await gotoApp(page, { ...schemaMockOverrides() }); // default index_status: idle
  await page.locator(RAIL.schema).first().waitFor({ state: "visible" });
  await page.waitForTimeout(2500); // give idle preheat a chance to (not) fire
  await expect(page.locator(HIDDEN_SCHEMA)).toHaveCount(0); // gating: no preheat
  const idleBootLT = sumLT((await snapshotPerf(page)).longTasks);

  console.log(
    `[preheat] first-show P50=${stats.p50}ms P95=${stats.p95}ms | ` +
      `rowsAtFirstPaint min=${minFirst} rowsSettled min=${minSettled} | ` +
      `blank-frame samples=${blank}/${samples.length} | ` +
      `boot long-task ms: ready=${readyBootLT} idle=${idleBootLT} ` +
      `delta(preheat)=${readyBootLT - idleBootLT}`,
  );
  // Blank-frame fix (A3): the preheated hidden panel now re-measures on the
  // hidden→visible transition, so the FIRST painted frame already contains rows.
  // Gate it: zero blank-frame samples, and every sample paints ≥1 row on frame 1.
  expect(blank).toBe(0);
  expect(minFirst).toBeGreaterThan(0);
  // The panel must also end up populated once settled.
  expect(minSettled).toBeGreaterThan(0);
});

// ── Scenario F: continuous rapid switching (long-task gate) ───────────────────
// Rapidly cycle SOQL → Schema → Logs over and over. Each switch is measured, and
// the acceptance gate "连续切换无 > 50ms long task" is asserted directly: no
// sample in the burst may see a >50ms long task.
test("continuous switching SOQL ↔ Schema ↔ Logs (long-task gate)", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);

  // Prime all three panels so every switch is a hot (already-visited) toggle.
  const cycle = [RAIL.schema, RAIL.logs, RAIL.soql];
  for (const sel of cycle) await measureClick(page, sel);

  const samples: Sample[] = [];
  const CYCLES = 20; // 20 × 3 = 60 rapid switches
  for (let c = 0; c < WARMUP + CYCLES; c++) {
    for (const sel of cycle) {
      const s = await measureClick(page, sel);
      if (c >= WARMUP) samples.push(s);
    }
  }
  const dom = await domNodes(page);
  const stats = summarize("Continuous switch cycle", samples, dom);
  results.push(stats);
  assertSane(stats);
  // Gate: continuous switching must produce zero >50ms long tasks.
  expect(stats.longTaskSamples).toBe(0);
});

// ── Persist the baseline doc ──────────────────────────────────────────────────
test.afterAll(() => {
  if (results.length === 0) return;
  const cpu = os.cpus()[0]?.model ?? "unknown";
  const mem = `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`;
  const table = [
    "| Scenario | n | P50 (ms) | P95 (ms) | min | max | long-task samples | max long task (ms) | DOM nodes |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.name} | ${r.n} | ${r.p50} | ${r.p95} | ${r.min} | ${r.max} | ${r.longTaskSamples} | ${r.maxLongTask} | ${r.domNodes ?? "—"} |`,
    ),
  ].join("\n");

  const buildLabel = PROD
    ? "**production build** (`vite build` + `vite preview`, minified React, no HMR)"
    : "**dev build** (Vite dev server)";
  const doc = `# Page-switch performance baseline${PROD ? " — PRODUCTION (Step 7)" : " (Step 1)"}

Generated by \`e2e/page-switch-perf.spec.ts\`${PROD ? " with `PERF_PROD=1`" : ""}. This is the red/green measurement
harness baseline for the page-switch perf plan
(\`2026-07-11-page-switch-perf.md\`). Numbers are ${buildLabel}.
${
  PROD
    ? "This is the acceptance-gate run: hot switches must hit P95 ≤ 16ms."
    : "Treat them as relative/directional — the plan's acceptance gate (P95 ≤ 16ms) is defined against a **release** build."
}

## Environment

- Build: ${PROD ? "production (`vite build` + `vite preview`, port 1421)" : "dev (Vite dev server, port 1421)"}, mocked Tauri IPC (no native window).
- Machine: ${os.type()} ${os.release()} (${os.arch()}), CPU ${cpu}, RAM ${mem}.
- Browser: Chromium (Playwright "Desktop Chrome"), viewport 1440×900.
- Mock data: 2000 objects / 800 fields / one field with 1000 picklist values /
  300 field references / a 4000-line log body.
- Sampling: ${WARMUP} warmup + ${SAMPLES} samples per direction.

## click → next paint definition

Custom scheme: click timestamp + **double-requestAnimationFrame** paint boundary
(React 18 flushes discrete click updates synchronously, so the DOM commit lands
before \`click()\` returns; the second rAF fires after that frame is painted).
Chosen over the Event Timing API because 'event' entries are dropped below a
16ms threshold and rounded to 8ms — they cannot resolve the sub-16ms hot
switches this plan targets. An Event Timing observer is still installed for
best-effort corroboration. See \`e2e/perf-harness.ts\` for the full rationale.

## Results (P50 / P95)

${table}

## Notes

- **DOM nodes** are \`document.querySelectorAll('*').length\` for the whole app
  in the given state (not just the panel subtree). The large-picklist state adds
  the 1000-row picklist table (unvirtualized) to the shared right pane.
- **Long tasks**: counted per measured window via a 'longtask' PerformanceObserver
  (>50ms by definition). "long-task samples" = how many of the ${SAMPLES} samples
  saw at least one long task during the click→paint window.
- **Cold entries** reload the page per sample so \`visited\` state resets and the
  panel remounts (genuine first mount). IPC is mocked/instant, so cold cost here
  reflects React mount + browser layout of the large tree, not real IPC latency.
- **Logs "big detail"**: the Logs list and raw LogView are virtualized, so a large
  log body does NOT balloon the DOM — reported DOM count stays modest by design.
- **Pending (Step 6)**: the "hidden mount → first show" virtualizer scenario is
  not measured — no virtualization exists on the Schema panes yet (ObjectList /
  FieldTable / picklist render eagerly). Add once Step 3/5 introduce virtualizers.
`;

  writeFileSync(new URL(BASELINE_PATH, import.meta.url), doc, "utf8");
});
