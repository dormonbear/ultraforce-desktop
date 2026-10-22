import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkBuiltSyntax, staticBlocks } from "./check-built-syntax.mjs";

test("finds static blocks in minified nested classes / 检出压缩嵌套类中的静态块", () => {
  assert.equal(staticBlocks("class A{static{this.x=1}m(){return class B{static{}}}}", "app.js").length, 2);
});

test("allows text and ordinary static methods / 允许文本和普通静态方法", () => {
  assert.deepEqual(staticBlocks('const text="static{}";/* static{} */class A{static x=1;static m(){}}', "app.js"), []);
});

test("rejects malformed JavaScript / 拒绝无法解析的 JavaScript", () => {
  assert.throws(() => staticBlocks("class {", "broken.js"), /Cannot parse/);
});

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ultraforce-built-syntax-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("rejects an empty output directory / 拒绝空构建目录", t => {
  assert.throws(() => checkBuiltSyntax(fixture(t)), /No built JavaScript/);
});

test("checks nested worker bundles too / 同时检查嵌套工作线程包", t => {
  const directory = fixture(t);
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(path.join(directory, "app.js"), "export const ready=true;");
  writeFileSync(path.join(directory, "assets", "editor.worker.js"), "class Worker{static{this.ready=true}}");
  assert.throws(() => checkBuiltSyntax(directory), /editor\.worker\.js: 1/);
});

test("accepts transformed app and worker output / 接受转换后的应用与工作线程产物", t => {
  const directory = fixture(t);
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(path.join(directory, "app.js"), "class App{};App.ready=true;");
  writeFileSync(path.join(directory, "assets", "editor.worker.js"), "class Worker{};Worker.ready=true;");
  writeFileSync(path.join(directory, "assets", "index.css"), "/* static{} */");
  assert.equal(checkBuiltSyntax(directory), 2);
});
