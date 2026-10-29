import { expect, test } from "@playwright/test";
import { dropLogFile, installMocks } from "./fixtures";

test("drop waits for the actual log listener / 拖放等待实际日志监听器", async ({ page }) => {
  await installMocks(page);
  await page.goto("/");
  await page.evaluate(() => {
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    const pending = new Map<unknown, Parameters<typeof add>>();
    window.addEventListener = function (...args: Parameters<typeof add>) {
      if (args[0] === "drop") pending.set(args[1], args);
      else add.apply(this, args);
    };
    window.removeEventListener = function (...args: Parameters<typeof remove>) {
      if (args[0] === "drop") pending.delete(args[1]);
      remove.apply(this, args);
    };
    Object.assign(window, {
      __ufPendingDrop: () => pending.size,
      __ufReleaseDrop: () => {
        for (const args of pending.values()) add.apply(window, args);
        pending.clear();
      },
    });
  });
  await page.getByRole("button", { name: "Logs", exact: true }).click();
  type Scope = {
    __ufPendingDrop: () => number;
    __ufReleaseDrop: () => void;
    __ufCalls: { cmd: string; args: Record<string, unknown> }[];
  };
  await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ufPendingDrop())).toBe(1);
  const body = "Owned dropped body {count}";
  // Queue release after the helper's first browser operation; no sleeps or redispatch. / 在辅助函数首个浏览器操作后排队释放，不休眠或重复发送。
  const dropping = dropLogFile(page, body);
  await page.evaluate(() => (window as unknown as Scope).__ufReleaseDrop());
  await dropping;
  await expect.poll(() => page.evaluate(() => (window as unknown as Scope).__ufCalls
    .filter((call) => call.cmd === "parse_log"))).toEqual([{ cmd: "parse_log", args: { body } }]);
  await expect(page.getByText(/API 60\.0/)).toBeVisible();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
});
