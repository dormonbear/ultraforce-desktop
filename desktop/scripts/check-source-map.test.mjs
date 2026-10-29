import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('@tailwindcss/vite'));
const nodeRequire = createRequire(viteRequire.resolve('@tailwindcss/node'));
const { SourceMapConsumer, SourceNode } = nodeRequire('source-map-js');
const { toSourceMap } = viteRequire('@tailwindcss/node');
const postcss = createRequire(require.resolve('vite'))('postcss');
const flatMap = () => ({ version: 3, sources: ['fixture.css'], sourcesContent: ['x;\n'], names: [], mappings: 'AAAA' });
const indexedMap = (offset, map = flatMap()) => ({ version: 3, sections: [{ offset: { line: offset, column: 0 }, map }] });

test('source-node work stays bounded past generated code / 超出生成代码后 source-node 工作量保持有界', () => {
  const consumer = new SourceMapConsumer(indexedMap(200));
  const original = SourceNode.prototype.add;
  let calls = 0;
  let node;
  // Count work with a small fixture; no timing threshold or huge conversion. / 用小夹具统计工作量，不依赖耗时门槛或巨大转换。
  SourceNode.prototype.add = function (...args) {
    calls++;
    return Reflect.apply(original, this, args);
  };
  try {
    node = SourceNode.fromStringWithSourceMap('x;\n', consumer);
  } finally {
    SourceNode.prototype.add = original;
  }
  assert.ok(calls <= 8, `SourceNode.add calls: ${calls} / SourceNode.add 调用次数：${calls}`);
  assert.equal(node.toString(), 'x;\n');
});

test('indexed map rejects oversized offsets before mapping work / 索引映射在处理前拒绝过大偏移', () => {
  assert.doesNotThrow(() => new SourceMapConsumer(indexedMap(10_000_000)));
  assert.throws(() => new SourceMapConsumer(indexedMap(10_000_001)), Error);
});

test('nested indexed offsets respect the aggregate bound / 嵌套索引偏移遵守总量上限', () => {
  assert.doesNotThrow(() => new SourceMapConsumer(indexedMap(5_000_000, indexedMap(5_000_000))));
  assert.throws(() => new SourceMapConsumer(indexedMap(6_000_000, indexedMap(6_000_000))), Error);
});

test('valid nested mapping preserves source positions / 合法嵌套映射保留源码位置', () => {
  const consumer = new SourceMapConsumer(indexedMap(2, indexedMap(2)));
  assert.deepEqual(consumer.originalPositionFor({ line: 5, column: 1 }), {
    source: 'fixture.css', line: 1, column: 0, name: null,
  });
});

test('actual Tailwind source-map generation preserves Unicode and mappings / 真实 Tailwind 源码映射生成保留 Unicode 和映射', () => {
  const source = { url: 'fixture.css', content: '/* Synthetic / 合成 */\n.fixture{color:red}\n' };
  const result = toSourceMap({ mappings: [
    { generatedPosition: { line: 1, column: 0 }, originalPosition: { line: 1, column: 0, source } },
    { generatedPosition: { line: 2, column: 0 }, originalPosition: { line: 2, column: 0, source } },
  ] });
  const raw = JSON.parse(result.raw);
  assert.deepEqual(raw.sources, ['fixture.css']);
  assert.deepEqual(raw.sourcesContent, [source.content]);
  const consumer = new SourceMapConsumer(raw);
  assert.deepEqual(consumer.originalPositionFor({ line: 2, column: 0 }), {
    source: 'fixture.css', line: 2, column: 0, name: null,
  });
  const encoded = result.inline.match(/base64,([^ ]+) /)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString(), result.raw);
});

test('actual PostCSS transformation preserves source-map content / 真实 PostCSS 转换保留源码映射内容', async () => {
  const css = '/* Synthetic / 合成 */\n.fixture{color:red}\n';
  const result = await postcss([(root) => root.walkDecls('color', (decl) => { decl.value = 'blue'; })])
    .process(css, { from: 'fixture.css', to: 'output.css', map: { inline: false, annotation: false } });
  assert.match(result.css, /color:blue/);
  const raw = result.map.toJSON();
  assert.deepEqual(raw.sourcesContent, [css]);
  const consumer = new SourceMapConsumer(raw);
  const position = consumer.originalPositionFor({ line: 2, column: 0 });
  assert.match(position.source, /fixture\.css$/);
  assert.equal(position.line, 2);
});
