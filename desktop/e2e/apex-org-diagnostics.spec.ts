import { expect, test, type Page } from "@playwright/test";
import { installMocks, openApexFile } from "./fixtures";

async function diagnosticTargets(page: Page) {
  return page.evaluate(() => {
    const calls = (window as unknown as {
      __ufCalls: { cmd: string; args: { org?: string } }[];
    }).__ufCalls;
    return ["apex_soql_diagnostics", "apex_diagnostics"].map((command) =>
      calls.filter((call) => call.cmd === command).at(-1)?.args.org);
  });
}

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`Apex diagnostic org / Apex 诊断组织: ${language}`, () => {
    test.use({ locale: language });
    test("refreshes diagnostics after switching organizations without editing / 不编辑代码时切换组织后刷新诊断", async ({ page }) => {
      await installMocks(page);
      await page.goto("/");
      await openApexFile(page);
      await expect.poll(() => diagnosticTargets(page)).toEqual(["dev@acme.com", "dev@acme.com"]);
      const previous = language === "zh-CN" ? "当前组织：DevHub。切换组织" : "Current org: DevHub. Switch org";
      await page.getByRole("button", { name: previous, exact: true }).click();
      await page.getByRole("dialog").getByText("Staging", { exact: true }).click();
      const current = language === "zh-CN" ? "当前组织：Staging。切换组织" : "Current org: Staging. Switch org";
      await expect(page.getByRole("button", { name: current, exact: true })).toBeVisible();
      await expect.poll(() => diagnosticTargets(page)).toEqual(["stg@acme.com", "stg@acme.com"]);
    });
  });
}
