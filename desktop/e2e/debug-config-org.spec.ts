import { expect, test, type Page } from "@playwright/test";
import { presetLevels } from "../src/debug-presets";
import { installMocks, openApexFile } from "./fixtures";

type Phase = "read" | "presets" | "write" | "write-error";
type Invoke = (command: string, args?: Record<string, unknown>, options?: { headers?: Record<string, string> }) => Promise<unknown>;
type Scope = {
  __TAURI_INTERNALS__: { invoke: Invoke };
  __ufDebugPending: () => number;
  __ufSettleDebug: () => Promise<void>;
  __ufCalls: { cmd: string; args: Record<string, unknown> }[];
};

async function delayedOldOrg(page: Page, phase: Phase) {
  await installMocks(page);
  await page.addInitScript(({ phase, first, current }) => {
    const scope = window as unknown as Scope;
    const invoke = scope.__TAURI_INTERNALS__.invoke;
    const held: { resolve: (value: unknown) => void; reject: (error: Error) => void; value: unknown }[] = [];
    const hold = (value: unknown) => new Promise<unknown>((resolve, reject) => held.push({ resolve, reject, value }));
    const config = (levels: unknown) => ({ traceFlagId: "synthetic", levels, expirationDate: null });
    const presets = (name: string, levels: unknown) => ({ traceFlags: [], entities: [], debugLevels: [{ id: name, developerName: name, levels }] });
    scope.__TAURI_INTERNALS__.invoke = (command, args = {}, options) => {
      const recorded = invoke(command, args, options);
      const old = args.org === "dev@acme.com";
      if (command === "get_debug_config") {
        if (old && phase === "read") return hold(config(first));
        return Promise.resolve(config(args.org === "stg@acme.com" ? current : first));
      }
      if (command === "load_logging_config") {
        if (old && phase === "presets") return hold(presets("A_OLD", first));
        return Promise.resolve(presets(args.org === "stg@acme.com" ? "B_CURRENT" : "A_CURRENT", args.org === "stg@acme.com" ? current : first));
      }
      if (old && command === "set_debug_config" && (phase === "write" || phase === "write-error")) {
        return hold(config(args.levels));
      }
      return recorded;
    };
    scope.__ufDebugPending = () => held.length;
    scope.__ufSettleDebug = async () => {
      for (const request of held.splice(0)) {
        if (phase === "write-error") request.reject(new Error("OLD_A_ERROR / 旧 A 错误"));
        else request.resolve(request.value);
      }
      // Observe React's response commit across a paint boundary. / 跨越绘制边界以观察 React 的响应提交。
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };
  }, { phase, first: presetLevels("Apex Only"), current: presetLevels("Full Debugging") });
}

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`debug config org ownership / 调试配置组织归属: ${language}`, () => {
    test.use({ locale: language });
    const words = language === "zh-CN" ? {
      debug: "调试级别", previous: "当前组织：DevHub。切换组织", current: "当前组织：Staging。切换组织",
    } : {
      debug: "Debug levels", previous: "Current org: DevHub. Switch org", current: "Current org: Staging. Switch org",
    };

    for (const phase of ["read", "presets", "write", "write-error"] as const) {
      test(`ignores previous-org ${phase} feedback / 忽略前一组织 ${phase} 反馈`, async ({ page }) => {
        await delayedOldOrg(page, phase);
        await page.goto("/");
        await openApexFile(page);
        if (phase !== "read") {
          await page.getByRole("button", { name: words.debug, exact: true }).click();
          if (phase === "write" || phase === "write-error") {
            await page.getByRole("combobox", { name: "Apex Code debug level", exact: true }).selectOption("INFO");
          }
        }
        await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ufDebugPending())).toBeGreaterThan(0);
        await page.getByRole("button", { name: words.previous, exact: true }).click();
        await page.getByRole("dialog").getByText("Staging", { exact: true }).click();
        await expect(page.getByRole("button", { name: words.current, exact: true })).toBeVisible();
        if (phase === "read") await page.getByRole("button", { name: words.debug, exact: true }).click();
        const category = page.getByRole("combobox", { name: "Apex Code debug level", exact: true });
        await expect(category).toHaveValue("FINEST");
        await expect(page.getByRole("combobox", { name: "Debug level preset", exact: true })).toHaveValue("B_CURRENT");
        await page.evaluate(() => (window as unknown as Scope).__ufSettleDebug());
        await expect(category).toHaveValue("FINEST");
        await expect(page.getByRole("combobox", { name: "Debug level preset", exact: true })).toHaveValue("B_CURRENT");
        await expect(page.getByText(/OLD_A_ERROR/)).toHaveCount(0);
      });
    }

    test("shows a current org read failure without old controls / 显示当前组织读取失败且不显示旧控件", async ({ page }) => {
      await installMocks(page);
      await page.addInitScript(() => {
        const scope = window as unknown as Scope, invoke = scope.__TAURI_INTERNALS__.invoke;
        scope.__TAURI_INTERNALS__.invoke = (command, args = {}, options) => {
          const recorded = invoke(command, args, options);
          if (command === "get_debug_config" && args.org === "stg@acme.com") {
            return Promise.reject(new Error("CURRENT_B_ERROR / 当前 B 错误"));
          }
          return recorded;
        };
      });
      await page.goto("/"); await openApexFile(page);
      await page.getByRole("button", { name: words.debug, exact: true }).click();
      await page.getByRole("button", { name: words.previous, exact: true }).click();
      await page.getByRole("dialog").getByText("Staging", { exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "CURRENT_B_ERROR / 当前 B 错误" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Apex Code debug level", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as Scope).__ufCalls.filter(call => call.cmd === "load_logging_config" && call.args.org === "stg@acme.com"))).toEqual([]);
    });
  });
}
