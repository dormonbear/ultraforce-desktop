import { test, expect } from "@playwright/test";
import { gotoApp } from "./fixtures";

const leaf = (label: string, dur: number) => ({
  label,
  detail: "",
  durNs: dur,
  selfNs: dur,
  children: [] as unknown[],
});

// The Tree view auto-expands the hot path (dominant-duration children) and
// starts cheap branches collapsed, so the bottleneck chain is visible without
// drowning in noise. Branches stay manually toggdleable.
test("Tree auto-expands the hot path, collapses cheap branches, toggles", async ({
  page,
}) => {
  await gotoApp(page, {
    parse_log: {
      raw: "x",
      apiVersion: "60.0",
      units: [
        {
          tree: [
            {
              label: "OUTER",
              detail: "",
              durNs: 1000,
              selfNs: 10,
              children: [
                { label: "HOT", detail: "", durNs: 900, selfNs: 10, children: [leaf("DEEP", 880)] },
                { label: "COLD", detail: "", durNs: 50, selfNs: 10, children: [leaf("HIDDEN", 40)] },
              ],
            },
          ],
          hotspots: [],
          statements: [],
          limits: [],
          exceptions: [],
        },
      ],
    },
  });

  await page.getByRole("button", { name: "Logs" }).click();
  await page.getByRole("button", { name: "OPEN" }).click();
  await page.getByRole("radio", { name: "tree" }).click();

  // Hot path is expanded; the cheap branch's child is hidden.
  await expect(page.getByText("DEEP")).toBeVisible();
  await expect(page.getByText("HIDDEN")).toHaveCount(0);

  // The only collapsed parent is COLD → its single "Expand" chevron reveals it.
  await page.getByRole("button", { name: "Expand" }).click();
  await expect(page.getByText("HIDDEN")).toBeVisible();
});
