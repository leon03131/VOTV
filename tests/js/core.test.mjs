// Tests for plugins/core/core.js and the built bundle, in a fake page (node:vm).
//   node --test tests/js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORE = readFileSync(path.join(ROOT, 'plugins/core/core.js'), 'utf8');
const bundle = (dev = false) => execFileSync('python', ['-c',
  `import sys; sys.path.insert(0, r'${path.join(ROOT, 'plugins')}'); import bundle; sys.stdout.write(bundle.build(dev=${dev ? 'True' : 'False'}))`],
  { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

function el(tag) {
  return {
    tag, children: [], style: { cssText: '' }, textContent: '', id: '', parent: null,
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
  };
}

function page({ ua = 'Mozilla/5.0 Cobalt test', version = {} } = {}) {
  const logs = [], store = new Map(), requests = [], timers = new Map();
  let nextId = 0, nextTimer = 0;
  const host = {
    version: () => JSON.stringify({ host: '0.0.0', api: 1, app: '7.30.301-votv.test', dev: false, ...version }),
    log: (level, msg) => logs.push([level, msg]),
    requestBundle() {},
    storageGet: (k) => (store.has(k) ? store.get(k) : null),
    storageSet: (k, v) => { if (v === null) store.delete(k); else store.set(k, v); },
    request: (json) => { const id = ++nextId; requests.push({ id, req: JSON.parse(json) }); return id; },
    toast() {}, reload() {},
  };
  const document = { body: el('body'), createElement: el, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const ctx = {
    VotHost: host, document, navigator: { userAgent: ua }, location: { pathname: '/tv', href: 'https://www.youtube.com/tv' },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => 0, addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const run = (code) => vm.runInContext(code, ctx);
  const flushTimers = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  return { ctx, host, logs, store, requests, timers, run, flushTimers, votv: () => ctx.__votv };
}

// objects from the vm realm have other prototypes: compare as plain JSON
const plain = (o) => JSON.parse(JSON.stringify(o));

test('core starts once and reports', () => {
  const p = page();
  p.run(CORE);
  const first = p.votv();
  assert.ok(first);
  assert.ok(p.logs.some(([l, m]) => l === 'i' && m.startsWith('core up: host 0.0.0 api 1')));
  p.run(CORE);
  assert.equal(p.votv(), first, 'second evaluation must not replace the runtime');
});

test('core does nothing without the bridge', () => {
  const p = page();
  delete p.ctx.VotHost;
  p.run(CORE);
  assert.equal(p.votv(), undefined);
});

test('a failing plugin is logged and does not stop others', () => {
  const p = page();
  p.run(CORE);
  p.run("__votv.define('bad', () => { throw new Error('boom'); }); __votv.define('good', () => ({ x: 1 }));");
  assert.ok(p.logs.some(([l, m]) => l === 'e' && m.includes('plugin bad failed') && m.includes('boom')));
  assert.equal(p.votv().plugins.good.x, 1);
  assert.equal(p.votv().plugins.bad, undefined);
});

test('request resolves with the host answer for its own id', async () => {
  const p = page();
  p.run(CORE);
  const a = p.votv().request({ url: 'https://a', timeout: 1000 });
  const b = p.votv().request({ url: 'https://b', timeout: 1000 });
  assert.deepEqual(p.requests.map((r) => r.req.url), ['https://a', 'https://b']);
  p.ctx.__votvHost.resolve(2, JSON.stringify({ status: 200, body: 'B' }));
  p.ctx.__votvHost.resolve(1, JSON.stringify({ status: 201, body: 'A' }));
  p.ctx.__votvHost.resolve(99, '{}'); // unknown id: ignored
  assert.deepEqual(plain(await a), { status: 201, body: 'A' });
  assert.deepEqual(plain(await b), { status: 200, body: 'B' });
  assert.equal(p.timers.size, 0, 'timeout timers are cleared');
});

test('request: bad JSON from host becomes an error result', async () => {
  const p = page();
  p.run(CORE);
  const r = p.votv().request({ url: 'https://a' });
  p.ctx.__votvHost.resolve(1, '{not json');
  const res = await r;
  assert.equal(res.status, 0);
  assert.match(res.error, /SyntaxError|JSON/);
});

test('request: host throwing resolves instead of rejecting', async () => {
  const p = page();
  p.run(CORE);
  p.host.request = () => { throw new Error('bridge gone'); };
  const res = await p.votv().request({ url: 'https://a' });
  assert.equal(res.status, 0);
  assert.match(res.error, /bridge gone/);
});

test('request: lost answer times out, a late answer is ignored', async () => {
  const p = page();
  p.run(CORE);
  const r = p.votv().request({ url: 'https://a', timeout: 1000 });
  const [timer] = [...p.timers.values()];
  assert.equal(timer.ms, 1000 * 2 + 5000);
  p.flushTimers();
  assert.deepEqual(plain(await r), { status: 0, error: 'no answer from host' });
  p.ctx.__votvHost.resolve(1, JSON.stringify({ status: 200 })); // must not throw
});

test('storage roundtrip and fallbacks', () => {
  const p = page();
  p.run(CORE);
  const s = p.votv().storage;
  assert.equal(s.get('missing', 'def'), 'def');
  s.set('k', { a: [1, 'два'] });
  assert.deepEqual(plain(s.get('k')), { a: [1, 'два'] });
  p.host.storageGet = (k) => (k === 'broken' ? '{oops' : null);
  assert.equal(s.get('broken', 'fallback'), 'fallback');
  s.set('k', undefined);
  assert.equal(p.store.has('k'), false);
});

test('toast adds and later removes an element', () => {
  const p = page();
  p.run(CORE);
  p.votv().toast('hello', 10);
  const box = p.ctx.document.body.children[0];
  assert.equal(box.id, 'votv-toasts');
  assert.equal(box.children[0].textContent, 'hello');
  p.flushTimers(); // fade
  p.flushTimers(); // remove
  assert.equal(box.children.length, 0);
});

test('release bundle: plugins load once even if evaluated twice', () => {
  const p = page();
  const code = bundle(false);
  p.run(code);
  p.run(code);
  const loaded = p.logs.filter(([, m]) => m === 'plugin diag loaded');
  assert.equal(loaded.length, 1);
  assert.ok(!code.includes('plugin: emu') && !code.includes('plugin: selftest'));
});

test('diag runs its report only once per app version outside dev mode', () => {
  const p = page();
  p.store.set('diag.version', JSON.stringify('7.30.301-votv.test'));
  p.run(bundle(false));
  // only the toast fade timers, no 6 s report timer
  assert.ok(![...p.timers.values()].some((t) => t.ms === 6000));
  const q = page();
  q.run(bundle(false));
  assert.ok([...q.timers.values()].some((t) => t.ms === 6000));
});

test('markBootOk is called after boot and updates API resolves via host bridge', async () => {
  const p = page();
  let bootOk = 0, rollbacks = 0, updateId = 10;
  p.host.markBootOk = () => { bootOk++; };
  p.host.rollbackPlugins = () => { rollbacks++; };
  p.host.checkUpdate = () => updateId;
  p.run(CORE);
  assert.equal(bootOk, 0);
  p.flushTimers();
  assert.equal(bootOk, 1, 'markBootOk called after boot timer');

  const checkPromise = p.votv().updates.check();
  p.ctx.__votvHost.resolve(updateId, JSON.stringify({ ok: true, updated: true, pluginVersion: '9.0.0' }));
  const res = await checkPromise;
  assert.equal(res.updated, true);
  assert.equal(res.pluginVersion, '9.0.0');

  p.votv().updates.rollback();
  assert.equal(rollbacks, 1);
});

test('emu plugin only touches the emulator', () => {
  for (const [ua, patched] of [['Mozilla/5.0 (Linux x86; Android 11) Cobalt (google, AOSP TV on x86)', true], ['Mozilla/5.0 Cobalt Xiaomi', false]]) {
    const p = page({ ua });
    let original = 0;
    p.ctx.MediaSource = { isTypeSupported: () => { original++; return false; } };
    p.ctx.HTMLMediaElement = function () {};
    p.ctx.HTMLMediaElement.prototype.canPlayType = () => '';
    p.run(bundle(true));
    assert.equal(p.ctx.MediaSource.isTypeSupported('video/webm; codecs="vp9"'), patched, ua);
  }
});
