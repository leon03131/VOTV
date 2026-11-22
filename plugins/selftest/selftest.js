/* End-to-end self-test of the host API inside the real app. Only bundled by dev/e2e.py
 * (enabled: false, devOnly). Prints "selftest PASS n/n" or "selftest FAIL ..." to logcat. */
__votv.define('selftest', (votv) => {
  const dev = votv.info.devUrl || '';
  const results = [];
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true });
      votv.log(`selftest ok   ${name}${detail ? ' — ' + detail : ''}`);
    } catch (e) {
      results.push({ name, ok: false });
      votv.error(`selftest FAIL ${name}: ${e && e.message || e}`);
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const b64 = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function run() {
    await check('bridge object', () => assert(typeof window.VotHost === 'object', 'no VotHost'));
    await check('version()', () => {
      const v = JSON.parse(VotHost.version());
      for (const k of ['host', 'api', 'package', 'app', 'abi', 'android']) assert(v[k] !== undefined, 'missing ' + k);
      assert(v.dev === true, 'dev flag not set');
      return `${v.package} ${v.app} ${v.abi}`;
    });
    await check('bundle guard', () => assert(window.__votvBundle === true && window.__votv === votv, 'guard flags'));
    await check('storage roundtrip', () => {
      const value = { s: 'тест ✓ "quotes" \\ \n', n: 42, a: [1, null, true] };
      votv.storage.set('selftest.key', value);
      assert(JSON.stringify(votv.storage.get('selftest.key')) === JSON.stringify(value), 'value differs');
      votv.storage.set('selftest.key', undefined);
      assert(votv.storage.get('selftest.key', 'gone') === 'gone', 'delete failed');
    });
    await check('https GET', async () => {
      const r = await votv.request({ url: 'https://www.gstatic.com/generate_204', timeout: 15000 });
      assert(r.status === 204, `status ${r.status} ${r.error || ''}`);
    });
    await check('https over IPv4 (SNI path)', async () => {
      const r = await votv.request({ url: 'https://www.gstatic.com/generate_204', timeout: 15000, forceIpv4: true });
      assert(r.status === 204, `status ${r.status} ${r.error || ''}`);
    });
    await check('https 404', async () => {
      const r = await votv.request({ url: 'https://www.gstatic.com/votv-selftest-404', timeout: 15000 });
      assert(r.status === 404, `status ${r.status} ${r.error || ''}`);
    });
    await check('plain http refused', async () => {
      const r = await votv.request({ url: 'http://example.com/', timeout: 5000 });
      assert(r.status === 0 && /https/.test(r.error || ''), `got ${r.status} ${r.error}`);
    });
    await check('bad request json handled', async () => {
      const r = await votv.request({ timeout: 5000 }); // no url
      assert(r.status === 0 && r.error, 'expected an error');
    });
    if (dev) {
      await check('POST text + headers (dev echo)', async () => {
        const body = 'привет, VOTV ✓ ' + Date.now();
        const r = await votv.request({ url: dev + '/echo', method: 'POST', body, headers: { 'X-Test': 'abc', 'Content-Type': 'text/plain; charset=utf-8' } });
        assert(r.status === 200, `status ${r.status} ${r.error || ''}`);
        assert(r.body === body, 'body differs');
        assert(r.headers['x-echo-method'] === 'POST' && r.headers['x-echo-test'] === 'abc', 'headers differ');
      });
      await check('binary roundtrip (dev echo)', async () => {
        const bytes = new Uint8Array(256 * 4).map((_, i) => i % 256);
        const r = await votv.request({ url: dev + '/echo', method: 'POST', bodyBase64: b64(bytes), responseType: 'base64' });
        assert(r.status === 200, `status ${r.status} ${r.error || ''}`);
        const back = unb64(r.bodyBase64);
        assert(back.length === bytes.length && back.every((b, i) => b === bytes[i]), 'bytes differ');
      });
      await check('parallel requests resolve to their own callers', async () => {
        const rs = await Promise.all([1, 2, 3, 4, 5].map((n) => votv.request({ url: dev + '/echo', method: 'POST', body: 'n' + n })));
        rs.forEach((r, i) => assert(r.body === 'n' + (i + 1), `request ${i + 1} got ${r.body} (${r.status} ${r.error || ''})`));
      });
    }
    await check('toast', () => { votv.toast('VOTV selftest'); });
    const failed = results.filter((r) => !r.ok);
    const line = `selftest ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}` +
      (failed.length ? ' failed: ' + failed.map((r) => r.name).join(', ') : '');
    (failed.length ? votv.error : votv.log)(line);
  }

  votv.whenBody(() => setTimeout(() => run().catch((e) => votv.error('selftest FAIL crashed', e)), 1500));
  return { run };
});
