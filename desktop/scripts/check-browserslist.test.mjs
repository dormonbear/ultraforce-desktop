import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// Isolate the test from user Browserslist settings and project statistics. / 隔离用户 Browserslist 设置及项目统计。
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("BROWSERSLIST")));
for (const key of Object.keys(inherited)) delete process.env[key];
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "true";
const root = realpathSync(mkdtempSync(join(tmpdir(), "uf-browserslist-")));
after(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("BROWSERSLIST")) delete process.env[key];
  Object.assign(process.env, inherited);
  rmSync(root, { recursive: true, force: true });
});

// Resolve through the installed CLI and Babel helper. / 沿已安装的 CLI 及 Babel 辅助包解析。
const require = createRequire(import.meta.url);
const cli = createRequire(require.resolve("@astryxdesign/cli"));
const jscodeshift = createRequire(cli.resolve("jscodeshift"));
const babel = createRequire(jscodeshift.resolve("@babel/core"));
const helper = createRequire(babel.resolve("@babel/helper-compilation-targets"));
const browserslist = helper("browserslist");
const statsLoader = helper("browserslist/node");
const entry = helper.resolve("browserslist");
const resolve = (query, options = {}) => browserslist(query, { path: root, stats: {}, ...options });

for (const key of ["__proto__", "toString", "valueOf", "constructor", "hasOwnProperty", "isPrototypeOf"]) {
  test(`synthetic stats key ${key} does not break an unrelated query / 合成统计键不会使无关查询失败`, () => {
    const stats = JSON.parse(`{"${key}":{"onekey":5},"chrome":{"100":50}}`);
    assert.deepEqual(resolve("chrome 100", { stats }), ["chrome 100"]);
  });
}

test("prototype-named statistics remain own data / 原型名称统计保留为自有数据", () => {
  const stats = JSON.parse('{"__proto__":{"first":1,"second":2},"chrome":{"100":50}}');
  const normalized = statsLoader.getStat({ stats }, browserslist.data);
  assert.equal(Object.hasOwn(normalized, "__proto__"), true);
  assert.deepEqual(normalized.__proto__, { first: 1, second: 2 });
  assert.notEqual(Object.getPrototypeOf(normalized), normalized.__proto__);
  assert.equal({}.first, undefined);
});

// Bound child time and memory; reference identity checks eviction without a large load. / 限制子进程时间与内存，通过引用一致性检测淘汰而无需大量负载。
function bounded(source) {
  const result = spawnSync(process.execPath, ["--max-old-space-size=96", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    const browserslist = createRequire(import.meta.url)(process.argv[1]);
    const resolve = (query) => browserslist(query, { stats: {} });
    ${source}
    process.stdout.write("ok");
  `, entry], { cwd: root, env: { ...process.env }, encoding: "utf8", timeout: 8000, killSignal: "SIGKILL", maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr.slice(0, 1500));
  assert.equal(result.stdout, "ok");
}

test("invalid baseline options throw without terminating the process / 无效基线选项抛出异常而不终止进程", () => {
  bounded(`
    const mapping = createRequire(process.argv[1])("baseline-browser-mapping");
    assert.throws(() => mapping.getCompatibleVersions({ targetYear: 2020, widelyAvailableOnDate: "2021-01-01" }), /cannot use targetYear/i);
    assert.ok(mapping.getCompatibleVersions({ targetYear: 2020 }).length > 0);
  `);
});

test("result cache evicts old queries and retains results / 结果缓存淘汰旧查询并保留结果", () => {
  bounded(`
    const original = resolve("chrome 100");
    assert.equal(resolve("chrome 100"), original);
    for (let index = 1; index <= 600; index++) resolve("since 1900-1-" + index);
    const fresh = resolve("chrome 100");
    assert.notEqual(fresh, original);
    assert.deepEqual(fresh, original);
  `);
});

test("parse cache evicts old queries and retains syntax / 解析缓存淘汰旧查询并保留语法", () => {
  bounded(`
    const original = browserslist.parse("chrome 100");
    assert.equal(browserslist.parse("chrome 100"), original);
    for (let index = 1; index <= 600; index++) browserslist.parse("chrome " + (100 + index));
    const fresh = browserslist.parse("chrome 100");
    assert.notEqual(fresh, original);
    assert.deepEqual(fresh, original);
  `);
});

test("ordinary queries and Babel target resolution remain compatible / 普通查询及 Babel 目标解析保持兼容", () => {
  assert.deepEqual(resolve(["chrome 100", "chrome 101", "not chrome 101"]), ["chrome 100"]);
  const stats = { dataByBrowser: { chrome: { 100: 75, 101: 25 } } };
  assert.deepEqual(resolve("> 30% in my stats", { stats }), ["chrome 100"]);
  assert.equal(browserslist.coverage(["chrome 100"], stats), 75);
  const getTargets = babel("@babel/helper-compilation-targets").default;
  assert.deepEqual(getTargets({ browsers: "chrome 100" }, { ignoreBrowserslistConfig: true }), { chrome: "100.0.0" });
});
