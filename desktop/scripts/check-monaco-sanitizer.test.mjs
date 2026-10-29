import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const options = {
  root,
  configFile: resolve(root, "vite.config.ts"),
  logLevel: "silent",
  build: { write: false },
};

test("production build uses the maintained sanitizer / 生产构建使用维护中的净化器", async () => {
  const result = await build(options);
  assert.ok(result.output.some((entry) => entry.type === "chunk"));
});

test("actual vendored import fails the production gate / 真实内置导入未通过生产构建门槛", async () => {
  let restored = false;
  await assert.rejects(build({
    ...options,
    plugins: [{
      name: "restore-vendored-sanitizer-control",
      enforce: "pre",
      transform(code, id) {
        if (!id.replace(/\\/g, "/").endsWith("/esm/vs/base/browser/domSanitize.js")) return;
        const original = code.replace("from 'dompurify'", "from './dompurify/dompurify.js'");
        restored = original !== code;
        return original;
      },
    }],
  }), /Production build must use maintained DOMPurify/);
  assert.equal(restored, true);
});
