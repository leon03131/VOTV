/* VOTV core runtime. The host evaluates the bundle once per document; this file comes first
 * and gives plugins a small API: window.__votv (logging, storage, HTTP, toasts, plugin registry). */
(function () {
  'use strict';
  if (window.__votv) return;
  const host = window.VotHost;
  if (!host) return;

  const safeJson = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  const fmt = (args) => args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack || a.message) : safeJson(a))).join(' ');
  const hostLog = (level, args) => { try { host.log(level, fmt(args)); } catch (e) { /* bridge gone */ } };

  let info = {};
  try { info = JSON.parse(host.version()); } catch (e) { /* old host */ }

  // HTTP and update results come back from Java as __votvHost.resolve(id, json).
  const pending = new Map();
  window.__votvHost = {
    resolve(id, json) {
      const done = pending.get(id);
      if (!done) return;
      pending.delete(id);
      let res;
      try { res = JSON.parse(json); } catch (e) { res = { status: 0, error: String(e) }; }
      done(res);
    },
  };

  function awaitHost(startCall, timeoutMs, fallbackError, extra) {
    return new Promise((resolve) => {
      let id;
      try {
        id = startCall();
      } catch (e) {
        resolve(Object.assign({ status: 0, error: String(e) }, extra));
        return;
      }
      const timer = setTimeout(() => {
        if (pending.delete(id)) resolve(Object.assign({ status: 0, error: fallbackError }, extra));
      }, timeoutMs);
      pending.set(id, (res) => { clearTimeout(timer); resolve(res); });
    });
  }

  const whenBody = (fn) => {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  };

  let toastBox = null;
  function toast(text, ms) {
    whenBody(() => {
      if (!toastBox) {
        toastBox = document.createElement('div');
        toastBox.id = 'votv-toasts';
        toastBox.style.cssText = 'position:fixed;top:2.5rem;right:2.5rem;z-index:2147483647;display:flex;flex-direction:column;gap:.5rem;pointer-events:none;font-family:Roboto,"YouTube Sans",sans-serif';
        document.body.appendChild(toastBox);
      }
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = 'background:rgba(20,20,20,.94);color:#f1f1f1;padding:12px 18px;border-radius:12px;font-size:22px;' +
        'border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 24px rgba(0,0,0,.45);transition:opacity .25s cubic-bezier(.2,.8,.2,1);max-width:560px';
      toastBox.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, ms || 4000);
    });
  }

  const votv = (window.__votv = {
    info,
    plugins: {},
    log: (...a) => hostLog('i', a),
    warn: (...a) => hostLog('w', a),
    error: (...a) => hostLog('e', a),
    toast,
    whenBody,
    /** fetch-like request without CORS: resolves to {status, headers, body | bodyBase64, error}.
     *  Never rejects; a lost answer resolves as {status: 0, error: 'no answer from host'}. */
    request(opts) {
      const limit = (opts.timeout || 30000) * 2 + 5000; // connect may be retried over IPv4
      return awaitHost(() => host.request(JSON.stringify(opts)), limit, 'no answer from host');
    },
    updates: {
      check() {
        if (typeof host.checkUpdate !== 'function') return Promise.resolve({ ok: false, error: 'host API < 4' });
        return awaitHost(() => host.checkUpdate(), 65000, 'update check timed out', { ok: false });
      },
      rollback() {
        if (typeof host.rollbackPlugins === 'function') host.rollbackPlugins();
      },
    },
    storage: {
      get(key, fallback) {
        try { const v = host.storageGet(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
      },
      set(key, value) { host.storageSet(key, value === undefined ? null : JSON.stringify(value)); },
    },
    /** Register a plugin. A failing plugin is logged and skipped; it never breaks the others. */
    define(id, factory) {
      try {
        votv.plugins[id] = factory(votv) || {};
        hostLog('i', [`plugin ${id} loaded`]);
      } catch (e) {
        hostLog('e', [`plugin ${id} failed:`, e]);
      }
    },
  });

  if (typeof host.markBootOk === 'function') {
    setTimeout(() => { try { host.markBootOk(); } catch (e) { /* bridge gone */ } }, 2000);
  }

  hostLog('i', [`core up: host ${info.host} api ${info.api} ${info.dev ? '(dev)' : ''} at ${location.pathname}`]);
})();
