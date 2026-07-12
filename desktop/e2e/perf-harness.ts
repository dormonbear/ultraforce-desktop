import type { Page } from "@playwright/test";

/**
 * Page-switch performance harness (Step 1 of the page-switch perf plan).
 *
 * ── click → next paint definition ────────────────────────────────────────────
 * We use the **click timestamp + double-requestAnimationFrame paint boundary**
 * scheme (allowed by the plan as an alternative to the Event Timing API):
 *
 *   t0 = performance.now()   // just before dispatching the click
 *   el.click()               // React flushes discrete (click) updates SYNC in
 *                            // React 18, so the DOM (hidden→visible toggle of
 *                            // the target panel subtree) is committed before
 *                            // click() returns.
 *   await rAF → rAF          // first rAF fires before the paint of the frame
 *                            // carrying those DOM mutations; the second fires
 *                            // AFTER that frame has been painted.
 *   t1 = performance.now()   // t1 - t0 ≈ click handler + React commit + browser
 *                            // layout/paint up to the next presented frame.
 *
 * Why not Event Timing as the primary metric: 'event' entries are only reported
 * above a durationThreshold (min 16ms) and rounded to 8ms, so the sub-16ms hot
 * switches this plan targets (P95 ≤ 16ms) fall below the reporting floor and
 * would be dropped. Double-rAF yields a clean, per-iteration end-to-end number
 * for every sample. We STILL install an Event Timing observer for corroboration
 * (reported best-effort; may be empty for fast/synthetic clicks).
 *
 * We also install a 'longtask' PerformanceObserver (>50ms tasks by definition)
 * and expose DOM node counting.
 */

// ── Injected page hook (runs before app scripts, survives reloads) ───────────
// Serialized via page.addInitScript — must be self-contained (no closured refs).
export function perfInitScript(): void {
  interface PerfState {
    longTasks: { start: number; dur: number }[];
    events: { name: string; start: number; dur: number }[];
  }
  const w = window as unknown as {
    __perf: PerfState;
    __perfMeasure: (
      selector: string,
    ) => Promise<{ clickToPaint: number; longTasks: number; maxLongTask: number }>;
    __perfMeasureFirstShow: (
      selector: string,
      contentSelector: string,
    ) => Promise<{
      clickToPaint: number;
      longTasks: number;
      maxLongTask: number;
      rowsAtFirstPaint: number;
      rowsSettled: number;
    }>;
    __perfReset: () => void;
    __perfSnapshot: () => PerfState;
    __perfDomNodes: () => number;
  };
  w.__perf = { longTasks: [], events: [] };

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* longtask unsupported */
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name === "click" || e.name === "pointerdown" || e.name === "mousedown") {
          w.__perf.events.push({ name: e.name, start: e.startTime, dur: e.duration });
        }
      }
      // @ts-expect-error durationThreshold is valid for the 'event' type
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch {
    /* event timing unsupported */
  }

  const raf = (): Promise<void> =>
    new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));

  // Resolve the target, snapshot the long-task baseline, and stamp t0 just before
  // the click — shared preamble for both measure variants.
  const beginMeasure = (selector: string) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error(`perfMeasure: no element for ${selector}`);
    return { el, ltBefore: w.__perf.longTasks.length, t0: performance.now() };
  };

  // Compute the click→paint sample from the timing/long-task baselines — shared
  // tail for both measure variants (firstShow spreads extra rows onto it).
  const finishSample = (t0: number, t1: number, ltBefore: number) => {
    const newLT = w.__perf.longTasks.slice(ltBefore).filter((x) => x.start >= t0 - 1);
    return {
      clickToPaint: t1 - t0,
      longTasks: newLT.length,
      maxLongTask: newLT.reduce((m, x) => Math.max(m, x.dur), 0),
    };
  };

  w.__perfMeasure = async (selector: string) => {
    const { el, ltBefore, t0 } = beginMeasure(selector);
    el.click();
    await raf();
    const t1 = performance.now();
    // Let the longtask observer callback flush before reading.
    await new Promise((res) => setTimeout(res, 0));
    return finishSample(t0, t1, ltBefore);
  };

  // First-show variant for the preheat scenario: the target panel is already
  // mounted but hidden (display:none → its virtualizers measured a 0-height
  // viewport). Besides click→paint we sample the row count at the *first* painted
  // frame after the hidden→visible commit vs. after it settles, to detect a blank
  // frame (rowsAtFirstPaint === 0 while rowsSettled > 0 ⇒ virtualizer emitted rows
  // only on a later frame via ResizeObserver).
  const raf1 = (): Promise<void> =>
    new Promise((res) => requestAnimationFrame(() => res()));
  w.__perfMeasureFirstShow = async (selector: string, contentSelector: string) => {
    const { el, ltBefore, t0 } = beginMeasure(selector);
    el.click();
    await raf1(); // fires before the paint of the frame carrying the show commit
    const rowsAtFirstPaint = document.querySelectorAll(contentSelector).length;
    await raf1(); // fires after that frame has painted
    const t1 = performance.now();
    const rowsSettled = document.querySelectorAll(contentSelector).length;
    await new Promise((res) => setTimeout(res, 0));
    return { ...finishSample(t0, t1, ltBefore), rowsAtFirstPaint, rowsSettled };
  };

  w.__perfReset = () => {
    w.__perf.longTasks = [];
    w.__perf.events = [];
  };
  w.__perfSnapshot = () => ({
    longTasks: w.__perf.longTasks.slice(),
    events: w.__perf.events.slice(),
  });
  w.__perfDomNodes = () => document.querySelectorAll("*").length;
}

// ── Measurement helpers (Node side) ──────────────────────────────────────────

export interface Sample {
  clickToPaint: number;
  longTasks: number;
  maxLongTask: number;
}

/** Dispatch a click on `selector` in-page and return the click→paint sample. */
export async function measureClick(page: Page, selector: string): Promise<Sample> {
  return page.evaluate(
    (sel) =>
      (
        window as unknown as {
          __perfMeasure: (s: string) => Promise<Sample>;
        }
      ).__perfMeasure(sel),
    selector,
  );
}

export interface FirstShowSample extends Sample {
  rowsAtFirstPaint: number;
  rowsSettled: number;
}

/** Click into a preheated (hidden-mounted) panel and measure its first show,
 * including a blank-frame probe (`contentSelector` counts the panel's rows). */
export async function measureFirstShow(
  page: Page,
  selector: string,
  contentSelector: string,
): Promise<FirstShowSample> {
  return page.evaluate(
    ([sel, content]) =>
      (
        window as unknown as {
          __perfMeasureFirstShow: (
            s: string,
            c: string,
          ) => Promise<FirstShowSample>;
        }
      ).__perfMeasureFirstShow(sel, content),
    [selector, contentSelector] as const,
  );
}

export async function domNodes(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __perfDomNodes: () => number }).__perfDomNodes(),
  );
}

export async function resetPerf(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __perfReset: () => void }).__perfReset(),
  );
}

export async function snapshotPerf(
  page: Page,
): Promise<{ longTasks: { start: number; dur: number }[]; events: unknown[] }> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __perfSnapshot: () => { longTasks: { start: number; dur: number }[]; events: unknown[] };
      }
    ).__perfSnapshot(),
  );
}

export const RAIL = {
  soql: 'button[aria-label="SOQL"]',
  apex: 'button[aria-label="Apex"]',
  logs: 'button[aria-label="Logs"]',
  schema: 'button[aria-label="Schema"]',
} as const;

// ── Stats ────────────────────────────────────────────────────────────────────

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface SeriesStats {
  name: string;
  n: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  longTaskSamples: number; // samples that saw a >50ms long task
  maxLongTask: number;
  domNodes?: number;
}

export function summarize(name: string, samples: Sample[], domNodeCount?: number): SeriesStats {
  const ctp = samples.map((s) => s.clickToPaint);
  return {
    name,
    n: samples.length,
    p50: round2(percentile(ctp, 50)),
    p95: round2(percentile(ctp, 95)),
    min: round2(Math.min(...ctp)),
    max: round2(Math.max(...ctp)),
    longTaskSamples: samples.filter((s) => s.longTasks > 0).length,
    maxLongTask: round2(Math.max(0, ...samples.map((s) => s.maxLongTask))),
    domNodes: domNodeCount,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Deterministic mock dataset (matches the schema/log IPC DTO shapes) ────────
// Fixed data — no randomness — so runs are comparable across machines.

const OBJECT_COUNT = 2000;
const FIELD_COUNT = 800;
const PICKLIST_COUNT = 1000;
const REFERENCE_COUNT = 300;

/** Name of the object whose detail we drive. schema_object_detail is mocked by
 * command name (args ignored), so its `name` must equal the object we click. */
export const TARGET_OBJECT = "Obj0000";
export const NORMAL_FIELD = "Field0001";
export const PICKLIST_FIELD = "Status__c";

interface SchemaField {
  name: string;
  label: string;
  fieldType: string;
  custom: boolean;
  nillable: boolean;
  referenceTo: string[];
  relationshipName: string | null;
  picklistValues: { label: string; value: string; active: boolean; defaultValue: boolean }[];
  restrictedPicklist: boolean;
  dependentPicklist: boolean;
  calculated: boolean;
  calculatedFormula: string | null;
  length: number;
  unique: boolean;
  inlineHelpText: string | null;
}

function pad(n: number, w = 4): string {
  return String(n).padStart(w, "0");
}

function buildObjects(): unknown[] {
  return Array.from({ length: OBJECT_COUNT }, (_, i) => ({
    name: `Obj${pad(i)}`,
    label: `Object ${i}`,
    custom: i % 3 === 0,
    keyPrefix: i % 5 === 0 ? null : pad(i % 999, 3),
  }));
}

// Deterministic fixture builder; the per-index branches encode the mock schema
// shape and reading them inline is clearer than table-driving this test data.
// fallow-ignore-next-line complexity
function buildFields(): SchemaField[] {
  const fields: SchemaField[] = [];
  for (let i = 0; i < FIELD_COUNT; i++) {
    const isPicklistField = i === 5;
    const name = isPicklistField ? PICKLIST_FIELD : `Field${pad(i)}`;
    fields.push({
      name,
      label: `Field ${i}`,
      fieldType: isPicklistField ? "picklist" : i % 4 === 0 ? "reference" : "string",
      custom: i % 2 === 0,
      nillable: i % 7 !== 0,
      referenceTo: i % 4 === 0 && !isPicklistField ? ["Account"] : [],
      relationshipName: i % 4 === 0 && !isPicklistField ? `Rel${i}` : null,
      picklistValues: isPicklistField
        ? Array.from({ length: PICKLIST_COUNT }, (_, p) => ({
            label: `Value ${p}`,
            value: `VAL_${pad(p, 4)}`,
            active: p % 10 !== 0,
            defaultValue: p === 0,
          }))
        : [],
      restrictedPicklist: isPicklistField,
      dependentPicklist: false,
      calculated: i % 11 === 0,
      calculatedFormula: i % 11 === 0 ? "TODAY()" : null,
      length: i % 4 === 0 ? 18 : 255,
      unique: i % 13 === 0,
      inlineHelpText: null,
    });
  }
  return fields;
}

function buildObjectDetail(): unknown {
  return {
    name: TARGET_OBJECT,
    label: "Object 0",
    keyPrefix: "001",
    custom: false,
    fields: buildFields(),
    childRelationships: Array.from({ length: 20 }, (_, i) => ({
      childSObject: `Obj${pad(i + 1)}`,
      relationshipName: `Children${i}`,
      field: `Parent${i}__c`,
    })),
    recordTypes: Array.from({ length: 6 }, (_, i) => ({
      name: `RT ${i}`,
      developerName: `RT_${i}`,
      active: true,
      master: i === 0,
      available: true,
    })),
  };
}

function buildFieldDependencies(): unknown {
  const types = ["ApexClass", "Flow", "ValidationRule", "Layout", "Report"];
  return {
    supported: true,
    items: Array.from({ length: REFERENCE_COUNT }, (_, i) => ({
      componentType: types[i % types.length],
      componentName: `Component_${pad(i)}`,
      componentId: `id_${pad(i)}`,
    })),
    fetchedAt: 1_700_000_000_000,
  };
}

/** A large log body + parsed detail for the "Logs with a big log detail" case. */
function buildLargeLog(): { view: unknown; body: string } {
  const body = Array.from({ length: 4000 }, (_, i) =>
    `08:00:${pad(i % 60, 2)}.${i} (${i})|USER_DEBUG|[${i}]|DEBUG|log row ${i}`,
  ).join("\n");
  const view = {
    raw: body,
    apiVersion: "60.0",
    units: [
      {
        tree: Array.from({ length: 50 }, (_, i) => ({
          label: "CODE_UNIT_STARTED",
          detail: `Method_${i}`,
          durNs: 2_000_000,
          selfNs: 1_000_000,
          startNs: i * 1000,
          children: [],
          source: null,
        })),
        hotspots: [],
        statements: [],
        limits: [],
        exceptions: [],
      },
    ],
  };
  return { view, body };
}

/** IPC command overrides for gotoApp: big schema + a large log body. */
export function schemaMockOverrides(): Record<string, unknown> {
  const { view } = buildLargeLog();
  return {
    schema_list_objects: buildObjects(),
    schema_object_detail: buildObjectDetail(),
    schema_field_dependencies: buildFieldDependencies(),
    schema_search: [],
    // Large log for the "big detail open" Logs scenario.
    get_log: view,
    parse_log: { apiVersion: view.apiVersion, units: (view as { units: unknown[] }).units },
  };
}
