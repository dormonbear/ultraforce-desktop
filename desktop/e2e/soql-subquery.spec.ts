import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./fixtures";
import type { ChildTableDto } from "../src/types";

/**
 * Verify horizontal column windowing and virtualized parent rows with child
 * details in the side panel, using the real production render in Chromium.
 * 使用 Chromium 中的真实正式渲染，验证横向列窗口化、父记录行虚拟化及侧栏子记录详情。
 * The mocked query returns the current typed childTables contract.
 * 模拟查询返回当前具备类型约束的 childTables 契约。
 */

// ---- Fixtures -------------------------------------------------------------

const WIDE_COLS = Array.from({ length: 60 }, (_, i) => `C${String(i).padStart(2, "0")}`);
const WIDE = {
  columns: WIDE_COLS,
  rows: Array.from({ length: 3 }, (_, r) => WIDE_COLS.map((c) => `r${r}${c}`)),
  totalSize: 3,
  done: true,
  childTables: [],
};

// ~150 parent rows trips row virtualization (>100 display items). Contacts
// subquery on the first 41 rows (row 1 is done:false), a second `Cases`
// relationship on a few. Child rows carry TYPED scalars (numbers stay numbers).
const NESTED_COLS = ["Id", "Name", "Contacts", "Cases"];
type ChildEntry = ChildTableDto;

const CASES_ROWS = new Set([0, 3, 7]);
/** Row 0 is done/3-rows (clean grid); row 1 is done:false (2 of 5 loaded). */
const contactsMeta = (i: number) =>
  i === 1 ? { done: false, total: 5, loaded: 2 } : { done: true, total: 3, loaded: 3 };

function contactsEntry(i: number): ChildEntry {
  const { done, total, loaded } = contactsMeta(i);
  return {
    rowIndex: i,
    column: "Contacts",
    totalSize: total,
    done,
    children: [],
    columns: ["ContactId", "FirstName", "LastName", "Age"],
    rows: Array.from({ length: loaded }, (_, k) => [
      `003x${i}_${k}`,
      `First${i}`,
      i === 0 && k === 0 ? "ZephyrUnique0" : `Last${i}_${k}`,
      20 + k, // number, not string
    ]),
  };
}
function casesEntry(i: number): ChildEntry {
  return {
    rowIndex: i,
    column: "Cases",
    totalSize: 2,
    done: true,
    children: [],
    columns: ["CaseId", "Subject", "Priority"],
    rows: [
      [`500x${i}_0`, `Subject ${i}`, 1],
      [`500x${i}_1`, `Other ${i}`, 2],
    ],
  };
}
function buildNested() {
  const rows: string[][] = [];
  const childTables: ChildEntry[] = [];
  for (let i = 0; i < 150; i++) {
    const hasContacts = i <= 40;
    const hasCases = CASES_ROWS.has(i);
    if (hasContacts) childTables.push(contactsEntry(i));
    if (hasCases) childTables.push(casesEntry(i));
    rows.push([
      `001x${i}`,
      `Account ${i}`,
      hasContacts ? String(contactsMeta(i).total) : "",
      hasCases ? "2" : "",
    ]);
  }
  return { columns: NESTED_COLS, rows, totalSize: 150, done: true, childTables };
}
const NESTED = buildNested();

// ---- Helpers --------------------------------------------------------------

/** Open a SOQL tab and run the (mocked) query; resolves when the grid paints. */
async function openAndRun(page: Page): Promise<number> {
  // `.first()` = the sidebar file entry (an already-open tab from a prior run in
  // the same test also matches "accounts.soql"; sidebar comes first in the DOM).
  await page.getByText("accounts.soql").first().click();
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();
  const t0 = Date.now();
  await page.getByText("RUN", { exact: false }).first().click();
  // A data header cell (each carries a per-column "Copy … column" button) is the
  // first proof the ResultTable rendered.
  await expect(dataHeaders(page).first()).toBeVisible({ timeout: 15000 });
  return Date.now() - t0;
}

/** Data (non-gutter, non-spacer) header cells: only these carry a copy button. */
function dataHeaders(page: Page) {
  return page.locator('thead th button[aria-label^="Copy "]');
}
const scrollBody = (page: Page) => page.locator("div.uf-scroll.overflow-x-hidden");

/** First rendered data column's id, read from its copy button aria-label. */
async function firstColId(page: Page): Promise<string> {
  const label = await dataHeaders(page).first().getAttribute("aria-label");
  return (label ?? "").replace(/^Copy /, "").replace(/ column$/, "");
}

type RowBox = { y: number; h: number; tag: string };
/**
 * Measure parent-grid rows, excluding the separate child-detail panel.
 * 测量父记录网格行，排除独立的子记录详情侧栏。
 */
async function rowBoxes(page: Page): Promise<RowBox[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("tbody tr[data-index]"))
      .map((tr) => {
        const r = tr.getBoundingClientRect();
        const idx = tr.getAttribute("data-index");
        return { y: r.y, h: r.height, tag: `${idx}:row` };
      })
      .sort((a, b) => a.y - b.y),
  );
}
function assertNoOverlap(boxes: RowBox[]) {
  for (let i = 0; i < boxes.length - 1; i++) {
    // Each row must end at or above the next row's top (1.5px tolerance for
    // sub-pixel border rounding).
    if (boxes[i].y + boxes[i].h > boxes[i + 1].y + 1.5) {
      throw new Error(
        `row overlap: ${boxes[i].tag} (y=${boxes[i].y.toFixed(1)} h=${boxes[i].h.toFixed(1)} end=${(boxes[i].y + boxes[i].h).toFixed(1)}) ` +
          `overlaps ${boxes[i + 1].tag} (y=${boxes[i + 1].y.toFixed(1)})\nall=${JSON.stringify(boxes)}`,
      );
    }
  }
}

// ---- Tests ----------------------------------------------------------------

test("check1: column window follows programmatic scrollLeft under overflow-x:hidden", async ({
  page,
}) => {
  await gotoApp(page, { run_soql: WIDE });
  await openAndRun(page);

  // Initial render is a WINDOW: far fewer than 60 data headers, and a right
  // spacer exists (an empty <th> with a width but no copy button).
  const initialCount = await dataHeaders(page).count();
  expect(initialCount).toBeGreaterThan(0);
  expect(initialCount).toBeLessThan(40);
  const spacerCount = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("thead th"));
    return ths.filter(
      (th) => !th.querySelector("button") && (th as HTMLElement).offsetWidth > 0,
    ).length;
  });
  // gutter (#) + at least one column spacer.
  expect(spacerCount).toBeGreaterThanOrEqual(2);
  const firstBefore = await firstColId(page);

  // Instrument a scroll listener, then write scrollLeft directly on the body.
  const body = scrollBody(page);
  await body.evaluate((el) => {
    (window as unknown as { __scrolled: number }).__scrolled = 0;
    el.addEventListener("scroll", () => {
      (window as unknown as { __scrolled: number }).__scrolled++;
    });
  });
  await body.evaluate((el) => {
    (el as HTMLElement).scrollLeft = 6000;
  });

  // scrollLeft must actually take (proves overflow-x:hidden is programmatically
  // scrollable) and fire a scroll event into the virtualizer.
  await expect
    .poll(() => body.evaluate((el) => (el as HTMLElement).scrollLeft))
    .toBeGreaterThan(1000);
  // A scroll event must reach the (element-bound) listener — dispatched async,
  // so poll rather than read once.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __scrolled: number }).__scrolled))
    .toBeGreaterThan(0);

  // The rendered column window advanced (first column id moved forward) and a
  // left spacer now exists with real width.
  await expect
    .poll(async () => firstColId(page))
    .not.toBe(firstBefore);
  const firstAfter = await firstColId(page);
  expect(Number(firstAfter.slice(1))).toBeGreaterThan(Number(firstBefore.slice(1)));
  const leftSpacerW = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("thead th")) as HTMLElement[];
    // Index 0 is the gutter; the next empty (button-less) th is the left spacer.
    for (let i = 1; i < ths.length; i++) {
      if (!ths[i].querySelector("button")) return ths[i].offsetWidth;
      break;
    }
    return 0;
  });
  expect(leftSpacerW).toBeGreaterThan(0);

  // Still a window, not the full 60.
  expect(await dataHeaders(page).count()).toBeLessThan(40);
});

test("check2: wheel deltaX forwarding advances the column window", async ({ page }) => {
  await gotoApp(page, { run_soql: WIDE });
  await openAndRun(page);

  const firstBefore = await firstColId(page);
  const body = scrollBody(page);
  const box = await body.boundingBox();
  if (!box) throw new Error("no body box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(5000, 0); // deltaX forwarded to scrollLeft

  await expect
    .poll(() => body.evaluate((el) => (el as HTMLElement).scrollLeft))
    .toBeGreaterThan(1000);
  await expect.poll(async () => firstColId(page)).not.toBe(firstBefore);
  expect(await dataHeaders(page).count()).toBeLessThan(40);
});

test("check3: sticky gutter stays at x0 and header/body cell counts match", async ({
  page,
}) => {
  await gotoApp(page, { run_soql: WIDE });
  await openAndRun(page);

  const body = scrollBody(page);
  const bodyBox = await body.boundingBox();
  await body.evaluate((el) => {
    (el as HTMLElement).scrollLeft = 6000;
  });
  await page.waitForTimeout(200);

  // Gutter header (#) is sticky-left: its left edge ≈ the scroll container left.
  const gutter = page.locator("thead th").first();
  await expect(gutter).toHaveText("#");
  const gBox = await gutter.boundingBox();
  expect(gBox && bodyBox).toBeTruthy();
  expect(Math.abs((gBox!.x) - (bodyBox!.x))).toBeLessThan(2);

  // Header row and first body row render the same number of cells (gutter +
  // spacers + windowed data cells).
  const headTh = await page.locator("thead tr").first().locator("th").count();
  const firstBodyRow = page.locator("tbody tr").first();
  const bodyTd = await firstBodyRow.locator("td").count();
  expect(headTh).toBe(bodyTd);
});

test("check4: row selection preserves child details under virtualization / 行选择在虚拟化下保留子记录详情", async ({
  page,
}) => {
  await gotoApp(page, { run_soql: NESTED });
  await openAndRun(page);

  // Row virtualization must be engaged (well under 150 rows in the DOM).
  const trCount = await page.locator("tbody tr").count();
  expect(trCount).toBeLessThan(60);

  // Selecting a parent opens its child cards beside the stable grid. / 选择父记录，在稳定网格旁打开子记录卡片。
  const first = page.getByRole("cell", { name: "Account 0", exact: true });
  await first.click();
  const detail = page.getByRole("button", { name: "Close detail panel", exact: true }).locator("..").locator("..");
  await expect(detail.getByText("Contacts (3)", { exact: true })).toBeVisible();
  await expect(detail.getByText("ZephyrUnique0", { exact: true })).toBeVisible();
  await expect(detail.getByText("20", { exact: true })).toBeVisible();

  // Detail selection keeps adjacent virtualized rows separate. / 详情选择不使相邻虚拟行重叠。
  assertNoOverlap(await rowBoxes(page));

  // Scroll far down and back; the expanded row must re-render intact.
  const body = scrollBody(page);
  await body.evaluate((el) => {
    (el as HTMLElement).scrollTop = 2000;
  });
  await expect(first).toHaveCount(0);
  await body.evaluate((el) => {
    (el as HTMLElement).scrollTop = 0;
  });
  await expect(first).toBeVisible();
  await expect(detail.getByText("Contacts (3)", { exact: true })).toBeVisible();
  await expect(detail.getByText("ZephyrUnique0", { exact: true })).toBeVisible();
  assertNoOverlap(await rowBoxes(page));

  // Select the truncated second row and retain its loaded/total distinction. / 选择被截断的第二行，保留已加载量与总量区别。
  await page.getByRole("cell", { name: "Account 1", exact: true }).click();
  await expect(detail.getByText("Contacts (5)", { exact: true })).toBeVisible();
  await expect(detail.getByText("2 of 5 loaded", { exact: true })).toBeVisible();
});

test("check5: windowed DOM stays small vs. total size", async ({ page }) => {
  await gotoApp(page, { run_soql: WIDE });
  await openAndRun(page);
  expect(await dataHeaders(page).count()).toBeLessThan(40); // total columns = 60

  await gotoApp(page, { run_soql: NESTED });
  await openAndRun(page);
  expect(await page.locator("tbody tr").count()).toBeLessThan(60); // total rows = 150
});

test("check6: first-load timing (report only)", async ({ page }) => {
  await gotoApp(page, { run_soql: WIDE });
  const ms = await openAndRun(page);
  console.log(`[timing] WIDE query → table visible: ${ms} ms`);
  expect(ms).toBeGreaterThan(0);
});
