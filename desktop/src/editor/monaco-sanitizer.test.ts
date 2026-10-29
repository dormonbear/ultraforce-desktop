// @vitest-environment jsdom
import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type Consumer = {
  sanitizeHtml: (html: string) => unknown;
  safeSetInnerHtml: (target: HTMLElement, html: string) => void;
};
let consumer: Consumer;
let purifier: { version: string; sanitize: (...args: unknown[]) => unknown };
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const monacoRequire = createRequire(require.resolve("monaco-editor/package.json"));
  const entry = join(dirname(monacoRequire.resolve("dompurify")), "purify.es.mjs");
  purifier = (await import(pathToFileURL(entry).href)).default;
  // Exercise Monaco's actual internal consumer, not a copied sanitizer. / 验证 Monaco 的真实内部调用方，而非复制的净化器。
  // @ts-expect-error -- Monaco does not publish internal module declarations. / Monaco 未发布内部模块声明。
  consumer = await import("monaco-editor/esm/vs/base/browser/domSanitize.js");
});
afterEach(() => vi.restoreAllMocks());

it("routes both output modes through the maintained package / 两种输出模式均调用维护中的软件包", () => {
  const sanitize = vi.spyOn(purifier, "sanitize");
  expect(String(consumer.sanitizeHtml("<strong>safe / 安全</strong>"))).toContain("<strong>");
  const target = document.createElement("div");
  consumer.safeSetInnerHtml(target, "<code>SELECT Id FROM Account</code>");
  expect(target.querySelector("code")?.textContent).toBe("SELECT Id FROM Account");
  expect(sanitize).toHaveBeenCalledTimes(2);
  for (const [, config] of sanitize.mock.calls) {
    expect(config).not.toHaveProperty("IN_PLACE", true);
  }
});

it("preserves benign markup and complete Unicode text / 保留正常标记及完整 Unicode 文本", () => {
  const target = document.createElement("div");
  consumer.safeSetInnerHtml(target, '<p><strong>Local / 本地 {value}</strong> &lt; &amp; <a href="https://example.invalid/help">Help / 帮助</a></p>');
  expect(target.querySelector("strong")?.textContent).toBe("Local / 本地 {value}");
  expect(target.querySelector("a")?.getAttribute("href")).toBe("https://example.invalid/help");
  expect(target.textContent).toContain("< &");
});

it("removes executable tags, attributes and URI schemes / 移除可执行标签、属性及 URI 协议", () => {
  const target = document.createElement("div");
  consumer.safeSetInnerHtml(target, '<p onclick="owned()">safe / 安全</p><script>owned()</script><a href="javascript:owned()">link / 链接</a><img src="data:text/html,owned" onerror="owned()"><svg onload="owned()"></svg>');
  expect(target.querySelector("script, svg, [onclick], [onerror], [onload]")).toBeNull();
  expect(target.querySelector("a")?.hasAttribute("href")).toBe(false);
  expect(target.querySelector("img")?.hasAttribute("src")).toBe(false);
  expect(target.textContent).toContain("safe / 安全");
});
