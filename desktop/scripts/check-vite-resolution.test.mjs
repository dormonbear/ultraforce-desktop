import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformWithEsbuild } from "vite";

const projectRequire = createRequire(import.meta.url);
const vitePackage = projectRequire.resolve("vite/package.json");
const viteRequire = createRequire(vitePackage);

function version(path) {
  return JSON.parse(readFileSync(path, "utf8")).version;
}

function atLeast(actual, minimum) {
  if (!/^\d+\.\d+\.\d+$/.test(actual)) return false;
  const current = actual.split(".").map(Number);
  for (let i = 0; i < minimum.length; i += 1) {
    if (current[i] !== minimum[i]) return current[i] > minimum[i];
  }
  return true;
}

test("Vite resolves a patched stable release / Vite 解析到已修复的稳定版本", () => {
  const actual = version(vitePackage);
  assert.ok(atLeast(actual, [7, 3, 7]), `Vite: ${actual}`);
});

test("Vite resolves a patched esbuild release / Vite 解析到已修复的 esbuild 版本", () => {
  const actual = version(viteRequire.resolve("esbuild/package.json"));
  assert.ok(atLeast(actual, [0, 28, 1]), `esbuild: ${actual}`);
});

test("Vite transforms TypeScript with a usable source map / Vite 转换 TypeScript 并生成可用源码映射", async () => {
  const result = await transformWithEsbuild(
    "export const total: number = 2 + 3;",
    "synthetic.ts",
    { loader: "ts", sourcemap: true },
  );
  const module = await import(`data:text/javascript,${encodeURIComponent(result.code)}`);
  assert.equal(module.total, 5);
  assert.deepEqual(result.map.sources, ["synthetic.ts"]);
});
