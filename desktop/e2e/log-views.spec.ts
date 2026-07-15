import { test, expect } from "@playwright/test";
import { gotoApp, dropLogFile } from "./fixtures";

// The Queries detail tab summarises SOQL/DML statements in a parsed log — the
// surface for spotting slow or repeated queries.
test("Queries tab lists SOQL statements with a summary", async ({ page }) => {
  await gotoApp(page, {
    parse_log: {
      raw: "x",
      apiVersion: "60.0",
      units: [
        {
          tree: [],
          hotspots: [],
          statements: [
            { kind: "soql", text: "SELECT Id FROM Account", rows: 3, durNs: 2_000_000 },
          ],
          limits: [],
          exceptions: [],
        },
      ],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await dropLogFile(page);
  await page.getByRole("radio", { name: "queries" }).click();

  await expect(page.getByText(/1 SOQL/)).toBeVisible();
  await expect(page.getByText("SELECT Id FROM Account")).toBeVisible();
});

// The log list toolbar offers a one-click "trace myself" that starts a 30-minute
// self-trace via the backend.
test("Set My Trace starts a 30-minute self-trace", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Logs" }).click();

  await page.getByRole("button", { name: "Trace myself for 30 minutes" }).click();
  await expect(page.getByText(/Tracing you for 30 min/)).toBeVisible();

  const called = await page.evaluate(() => {
    const calls = (window as unknown as { __ufCalls: { cmd: string }[] }).__ufCalls ?? [];
    return calls.some((c) => c.cmd === "quick_self_trace");
  });
  expect(called).toBe(true);
});

// Syntax-highlighting the Raw tab costs ~13ms/frame across the visible rows —
// enough to strand a large log's viewport on stale (blank) content while the
// scrollbar is dragged. LogView drops to plain lines while scrolling and colours
// on settle; this pins both halves of that trade.
test("Raw tab renders plain lines while scrolling and re-colours on settle", async ({
  page,
}) => {
  const raw = Array.from(
    { length: 5000 },
    (_, i) => `12:00:0${i % 10}.${i} (${i * 977})|USER_DEBUG|[${i}]|DEBUG|row ${i}`,
  ).join("\n");
  await gotoApp(page, {
    parse_log: {
      raw,
      apiVersion: "60.0",
      units: [{ tree: [], hotspots: [], statements: [], limits: [], exceptions: [] }],
    },
  });
  await page.getByRole("button", { name: "Logs" }).click();
  await dropLogFile(page, "x");

  const find = `[...document.querySelectorAll("div")].find((d) => d.scrollHeight > 50000)`;
  const spans = () =>
    page.evaluate(`${find}.querySelectorAll("div[style*='translateY'] span").length`);

  // Coloured at rest.
  await expect.poll(spans).toBeGreaterThan(0);
  // Plain mid-scroll. Scroll and count in one evaluate: isScrolling resets 100ms
  // after the last scroll, which a round-trip can outlast under load.
  const during = await page.evaluate(`new Promise((resolve) => {
    const el = ${find};
    el.scrollTop += 20000;
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        resolve(el.querySelectorAll("div[style*='translateY'] span").length),
      ),
    );
  })`);
  expect(during).toBe(0);
  // Coloured again once scrolling settles.
  await expect.poll(spans).toBeGreaterThan(0);
});
