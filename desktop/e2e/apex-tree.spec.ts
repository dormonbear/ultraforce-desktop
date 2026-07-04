import { test, expect } from "@playwright/test";
import { gotoApp, dropLogFile } from "./fixtures";

const leaf = (label: string, dur: number) => ({
  label,
  detail: "",
  durNs: dur,
  selfNs: dur,
  children: [] as unknown[],
});

// The execution tree is visualized as a flame timeline (the old collapsible
// DOM tree with per-branch Expand toggles was replaced by the canvas flame
// chart). A non-trivial nested tree must produce a rendered flame canvas rather
// than the "No execution tree" empty state.
test("execution tree renders as a flame timeline", async ({ page }) => {
  await gotoApp(page, {
    parse_log: {
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
  await dropLogFile(page);
  await page.getByRole("radio", { name: "timeline" }).click();

  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByText("No execution tree")).toHaveCount(0);
  // Flame-chart affordances confirm the tree was laid out (not the empty state).
  await expect(page.getByRole("button", { name: "Reset zoom" })).toBeVisible();
});
