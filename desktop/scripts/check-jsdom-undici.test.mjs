import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const jsdomRequire = createRequire(require.resolve('jsdom/package.json'));
const { Agent, MockAgent } = jsdomRequire('undici');
const { JSDOM } = require('jsdom');

for (const option of ['tls', 'connect']) {
  test(`jsdom's Undici preserves ${option} verification callbacks / jsdom 的 Undici 保留 ${option} 验证回调`, async (t) => {
    const mock = new MockAgent();
    mock.disableNetConnect();
    mock.get('https://synthetic.invalid').intercept({ path: '/', method: 'GET' }).reply(200, 'synthetic');
    const checkServerIdentity = () => new Error('Synthetic rejection / 合成拒绝');
    const original = { servername: 'synthetic.invalid', checkServerIdentity };
    let forwarded;
    const agent = new Agent({
      [option]: original,
      factory(_origin, options) {
        forwarded = options[option];
        return mock;
      },
    });
    t.after(() => agent.close());
    const response = await agent.request({ origin: 'https://synthetic.invalid', path: '/', method: 'GET' });
    assert.equal(await response.body.text(), 'synthetic');
    assert.notEqual(forwarded, original);
    assert.equal(forwarded.servername, original.servername);
    // Check forwarding, without claiming a real TLS handshake was exercised. / 检查转发行为，不声称执行了真实 TLS 握手。
    assert.equal(forwarded.checkServerIdentity, checkServerIdentity);
    mock.assertNoPendingInterceptors();
  });
}

test('jsdom resource and XHR dispatch remain compatible / jsdom 资源及 XHR 分派保持兼容', async (t) => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  t.after(() => mock.close());
  const origin = 'https://synthetic.invalid';
  const pool = mock.get(origin);
  pool.intercept({ path: '/page', method: 'GET' }).reply(200, '<p>合成 fixture</p>', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  pool.intercept({ path: '/data', method: 'GET' }).reply(200, '{"label":"合成"}', {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  const dom = await JSDOM.fromURL(`${origin}/page`, { resources: { dispatcher: mock } });
  t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelector('p').textContent, '合成 fixture');
  const result = await new Promise((resolve, reject) => {
    const xhr = new dom.window.XMLHttpRequest();
    xhr.open('GET', '/data');
    xhr.responseType = 'json';
    xhr.onload = () => resolve({ status: xhr.status, label: xhr.response.label });
    xhr.onerror = () => reject(new Error('Synthetic XHR failed / 合成 XHR 失败'));
    xhr.send();
  });
  assert.deepEqual(result, { status: 200, label: '合成' });
  mock.assertNoPendingInterceptors();
});
