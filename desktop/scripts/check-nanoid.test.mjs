import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite'));
const postcssRequire = createRequire(viteRequire.resolve('postcss'));
const postcss = viteRequire('postcss');
const nonSecure = postcssRequire('nanoid/non-secure');
const secure = postcssRequire('nanoid');

function withoutRandomCalls(fn) {
  const original = Math.random;
  let calls = 0;
  Math.random = () => {
    if (++calls > 2) throw new Error('Random call limit / 随机调用次数限制');
    return 0;
  };
  try {
    assert.equal(fn(), '');
    assert.equal(calls, 0);
  } finally {
    Math.random = original;
  }
}

test('non-secure ID handles negative lengths without generating bytes / 非安全 ID 在负长度时不生成随机数', () => {
  withoutRandomCalls(() => nonSecure.nanoid(-1));
});

test('non-secure custom alphabet handles negative lengths / 非安全自定义字符集处理负长度', () => {
  withoutRandomCalls(() => nonSecure.customAlphabet('abc', -1)());
});

test('custom random handles zero length before requesting bytes / 自定义随机生成器在请求字节前处理零长度', () => {
  let calls = 0;
  const generate = secure.customRandom('a', 0, () => {
    if (++calls > 2) throw new Error('Random call limit / 随机调用次数限制');
    return new Uint8Array(0);
  });
  assert.equal(generate(), '');
  assert.equal(calls, 0);
});

test('secure custom alphabet handles a zero-length override / 安全自定义字符集处理零长度覆盖值', () => {
  const original = crypto.randomFillSync;
  let calls = 0;
  crypto.randomFillSync = (bytes) => {
    if (++calls > 2) throw new Error('Random call limit / 随机调用次数限制');
    bytes.fill(0);
    return bytes;
  };
  try {
    assert.equal(secure.customAlphabet('a', 6)(0), '');
    assert.equal(calls, 0);
  } finally {
    crypto.randomFillSync = original;
  }
});

test('positive lengths preserve normal generator behavior / 正长度保持正常生成行为', () => {
  assert.match(nonSecure.nanoid(6), /^[\w-]{6}$/);
  assert.match(nonSecure.customAlphabet('abc', 6)(), /^[abc]{6}$/);
  assert.match(secure.nanoid(6), /^[\w-]{6}$/);
  assert.match(secure.customAlphabet('abc', 6)(), /^[abc]{6}$/);
  const generate = secure.customRandom('a', 3, (size) => new Uint8Array(size));
  assert.equal(generate(), 'aaa');
});

test('PostCSS still assigns a generated input ID and transforms CSS / PostCSS 仍生成输入 ID 并转换 CSS', async () => {
  const source = '.fixture { color: red }';
  const root = postcss.parse(source);
  assert.match(root.source.input.from, /^<input css [\w-]{6}>$/);
  const result = await postcss([(tree) => tree.walkDecls('color', (decl) => { decl.value = 'blue'; })])
    .process(source, { from: undefined, map: false });
  assert.match(result.css, /color: blue/);
});
