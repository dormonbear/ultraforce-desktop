import { expect, test, type Page } from "@playwright/test";
import { installMocks } from "./fixtures";

type Invoke = (command: string, args?: Record<string, unknown>, options?: { headers?: Record<string, string> }) => Promise<unknown>;
type Scope = {
  __TAURI_INTERNALS__: { invoke: Invoke };
  __ufTracePending: () => number;
  __ufSettleTrace: () => Promise<void>;
};

async function holdOldTrace(page: Page, phase: "read" | "write" | "error") {
  await installMocks(page);
  await page.addInitScript(({ phase }) => {
    const scope = window as unknown as Scope, invoke = scope.__TAURI_INTERNALS__.invoke;
    const held: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
    scope.__TAURI_INTERNALS__.invoke = (command, args = {}, options) => {
      const recorded = invoke(command, args, options);
      if (args.org === "dev@acme.com" && (
        (phase === "read" && command === "get_debug_config") ||
        (phase !== "read" && command === "quick_self_trace")
      )) return new Promise((resolve, reject) => held.push({ resolve, reject }));
      if (command === "get_debug_config") return Promise.resolve({ expirationDate: null });
      return recorded;
    };
    scope.__ufTracePending = () => held.length;
    scope.__ufSettleTrace = async () => {
      for (const request of held.splice(0)) {
        if (phase === "error") request.reject(new Error("OLD_TRACE_ERROR"));
        else request.resolve({ expirationDate: "2099-01-01T00:00:00Z" });
      }
      // Observe the response commit across a paint boundary. / 跨越绘制边界以观察响应提交。
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };
  }, { phase });
}

for (const language of ["en-US", "zh-CN"] as const) {
  test.describe(`self-trace org ownership / 自身跟踪组织归属: ${language}`, () => {
    test.use({ locale: language });
    for (const phase of ["read", "write", "error"] as const) {
      test(`ignores old org ${phase} feedback / 忽略旧组织 ${phase} 反馈`, async ({ page }) => {
        await holdOldTrace(page, phase); await page.goto("/");
        await page.getByRole("button", { name: language === "zh-CN" ? "日志" : "Logs", exact: true }).click();
        const trace = page.getByRole("button", { name: "Trace myself for 30 minutes", exact: true });
        await expect(trace).toBeEnabled();
        if (phase !== "read") await trace.click();
        await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ufTracePending())).toBeGreaterThan(0);
        await page.getByRole("button", {
          name: language === "zh-CN" ? "当前组织：DevHub。切换组织" : "Current org: DevHub. Switch org", exact: true,
        }).click();
        await page.getByRole("dialog").getByText("Staging", { exact: true }).click();
        await expect(page.getByRole("button", {
          name: language === "zh-CN" ? "当前组织：Staging。切换组织" : "Current org: Staging. Switch org", exact: true,
        })).toBeVisible();
        await page.evaluate(() => (window as unknown as Scope).__ufSettleTrace());
        await expect(trace).toBeEnabled();
        await expect(page.getByText(/OLD_TRACE_ERROR|Tracing you for 30 min|已为您启用 30 分钟跟踪/)).toHaveCount(0);
      });
    }
  });
}
