import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const projectRequire = createRequire(import.meta.url);
const cliEntry = projectRequire.resolve("@astryxdesign/cli");
const cliRequire = createRequire(cliEntry);
const { z } = cliRequire("zod");

test("bounded arrays reject excess length before visiting elements / 有上限数组先拒绝超长输入再处理元素", () => {
  let visited = 0;
  const element = z.unknown().transform((value) => {
    visited += 1;
    return value;
  });
  const result = z.array(element).max(3).safeParse(Array(32).fill(1));

  assert.equal(result.success, false);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, "too_big");
  assert.equal(visited, 0);
});

test("arrays within the limit still validate their elements / 上限内数组仍会校验元素", () => {
  const schema = z.array(z.string()).max(3);
  assert.deepEqual(schema.safeParse(["alpha", "beta"]).data, ["alpha", "beta"]);
  const invalid = schema.safeParse(["alpha", 1]);
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.issues[0].code, "invalid_type");
});

test("the installed CLI validates synthetic configuration / 已安装的 CLI 校验合成配置", async () => {
  const schemaPath = join(dirname(cliEntry), "../src/lib/config-schema.mjs");
  const { AstryxConfigSchema } = await import(pathToFileURL(schemaPath).href);
  assert.equal(AstryxConfigSchema.safeParse({ integrations: ["synthetic"] }).success, true);
  assert.equal(AstryxConfigSchema.safeParse({ integrations: [1] }).success, false);
});
