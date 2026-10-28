import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./fixtures";

const raw = (marker: string) => `67.0 APEX\n16:00:00.0 (20)|METHOD_ENTRY|[1]|01p|SyntheticClass.run()\n16:00:00.0 (30)|USER_DEBUG|[1]|DEBUG|${marker}`;

async function installRace(page: Page, scenario: string) {
  await page.evaluate(({ scenario, oldRaw, currentRaw }) => {
    const win = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      __oldLogRequestStarted: boolean;
      __finishOldLogRequest: () => Promise<void>;
    };
    const invoke = win.__TAURI_INTERNALS__.invoke;
    const mapping = scenario.startsWith("mapping");
    const fails = scenario.endsWith("error");
    const dto = (raw: string) => ({ raw, apiVersion: "60.0", units: [] });
    win.__oldLogRequestStarted = false;
    win.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      const delayed = mapping
        ? cmd === "source_line_indices" && args?.body === oldRaw
        : cmd === "get_log" && args?.id === "07L1";
      if (delayed) {
        let resolve!: (value: unknown) => void;
        let reject!: (error: Error) => void;
        const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
        win.__oldLogRequestStarted = true;
        win.__finishOldLogRequest = async () => {
          if (fails) reject(new Error("OLD_FAILURE / 旧失败"));
          else resolve(mapping ? [3, 4] : dto(oldRaw));
          await pending.catch(() => {});
          // Let the response chain and React commit before checking the view. / 检查视图前让响应链及 React 提交完成。
          await new Promise<void>(yes => requestAnimationFrame(() => requestAnimationFrame(() => yes())));
        };
        return pending;
      }
      if (cmd === "get_log") return Promise.resolve(dto(args?.id === "07L1" ? oldRaw : currentRaw));
      return invoke(cmd, args);
    };
  }, {
    scenario,
    oldRaw: raw("OLD_LOG").replace("\n", "\n16:00:00.0 (1)|EXECUTION_STARTED\n16:00:00.0 (2)|HEAP_ALLOCATE|[EXTERNAL]|Bytes:1\n"),
    currentRaw: raw("CURRENT_LOG"),
  });
}

for (const scenario of ["body", "error", "mapping", "mapping-error"] as const) {
  test(`keeps the selected log after late ${scenario} / 迟到响应后保留选中日志：${scenario}`, async ({ page }) => {
    await gotoApp(page, { source_line_indices: [1, 2], source_at_line: { className: "SyntheticClass", line: 1 } });
    await installRace(page, scenario);
    await page.getByRole("button", { name: "Logs", exact: true }).click();
    await page.getByRole("button", { name: /runTestsSynchronous/ }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __oldLogRequestStarted: boolean }).__oldLogRequestStarted)).toBe(true);
    await page.getByRole("button", { name: /opalrest/ }).click();
    const currentLine = page.getByRole("button", { name: /USER_DEBUG.*CURRENT_LOG/ });
    await expect(currentLine).toBeVisible();
    await page.evaluate(() => (window as unknown as { __finishOldLogRequest: () => Promise<void> }).__finishOldLogRequest());
    await expect(currentLine).toBeVisible();
    await expect(page.getByText(/OLD_FAILURE/)).toHaveCount(0);
    await currentLine.click();
    await expect(page.getByRole("dialog").getByRole("heading")).toContainText("SyntheticClass");
    await expect.poll(() => page.evaluate(() => (window as unknown as {
      __ufCalls: { cmd: string; args: Record<string, unknown> }[];
    }).__ufCalls.filter(call => call.cmd === "source_at_line").map(call => call.args)))
      .toEqual([{ body: raw("CURRENT_LOG"), line: 2 }]);
  });
}
