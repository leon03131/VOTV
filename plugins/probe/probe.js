/* Dev only: explore youtube.com/tv internals (ytlr components) and log what we find.
 * Logs lines starting with "probe " (logcat tag VOTV). Read-only: never changes the page. */
__votv.define('probe', (votv) => {
  const TARGETS = [
    'ytlr-player-actions-container', 'ytlr-tv-secondary-nav-renderer', 'ytlr-setting-boolean-renderer',
    'ytlr-setting-single-option-menu-renderer', 'ytlr-overlay-panel-header-renderer', 'ytlr-player-controls',
    'ytlr-button-renderer', 'ytlr-compact-link-renderer', 'ytlr-overlay-panel-item-list-renderer',
  ];
  const DEEP = ['ytlr-player-actions-container', 'ytlr-tv-secondary-nav-renderer', 'ytlr-setting-boolean-renderer'];
  const seen = new Set();
  const out = (label, obj) => {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (let i = 0; i < s.length; i += 3000) votv.log(`probe ${label}${s.length > 3000 ? ` [${i / 3000}]` : ''} ${s.slice(i, i + 3000)}`);
  };

  const shape = (v, depth = 2) => {
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? 'ƒ' : typeof v === 'string' ? v.slice(0, 60) : v;
    if (Array.isArray(v)) return depth <= 0 ? `[${v.length}]` : v.slice(0, 4).map((x) => shape(x, depth - 1));
    const o = {};
    for (const k of Object.keys(v).slice(0, 25)) o[k] = depth <= 0 ? typeof v[k] : shape(v[k], depth - 1);
    return o;
  };

  function methods(inst) {
    const res = {};
    for (let p = Object.getPrototypeOf(inst), d = 0; p && p !== Object.prototype && d < 4; p = Object.getPrototypeOf(p), d++) {
      for (const k of Object.getOwnPropertyNames(p)) {
        if (k === 'constructor' || res[k]) continue;
        const desc = Object.getOwnPropertyDescriptor(p, k);
        if (desc && typeof desc.value === 'function') {
          res[k] = `L${d}(${desc.value.length}) ` + String(desc.value).replace(/\s+/g, ' ').slice(0, 140);
        } else if (desc && desc.get) {
          res[k] = `L${d} get`;
        }
      }
    }
    return res;
  }

  // Own zero-arg functions (bound helpers) and getters: what do they return?
  function calls(inst) {
    const res = {};
    for (const k of Object.keys(inst)) {
      const f = inst[k];
      if (typeof f !== 'function' || f.length !== 0) continue;
      const src = String(f).replace(/\s+/g, ' ');
      let val;
      try { val = shape(f.call(inst), 6); } catch (e) { val = 'throws ' + e; }
      res[k] = { src: src.slice(0, 220), val };
    }
    for (let p = Object.getPrototypeOf(inst); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const k of Object.getOwnPropertyNames(p)) {
        const d = Object.getOwnPropertyDescriptor(p, k);
        if (d && d.get && !(k in res)) {
          try { res['get ' + k] = { src: String(d.get).replace(/\s+/g, ' ').slice(0, 220), val: shape(d.get.call(inst), 3) }; } catch (e) { res['get ' + k] = 'throws ' + e; }
        }
      }
    }
    return res;
  }

  function describe(el, deep) {
    const inst = el.__instance;
    if (!inst) return { tag: el.tagName.toLowerCase(), instance: null, keys: Object.keys(el).filter((k) => k.startsWith('__')) };
    const d = {
      tag: el.tagName.toLowerCase(),
      ctor: inst.constructor && inst.constructor.name,
      own: Object.keys(inst).slice(0, 60),
      props: inst.props ? shape(inst.props, deep ? 4 : 2) : null,
      state: inst.state ? shape(inst.state, 1) : null,
      methods: methods(inst),
    };
    if (deep) {
      d.template = String(Object.getPrototypeOf(inst).template || '').replace(/\s+/g, ' ').slice(0, 2500);
      d.calls = calls(inst);
    }
    return d;
  }

  function tags() {
    const counts = {};
    document.querySelectorAll('*').forEach((e) => {
      const t = e.tagName.toLowerCase();
      if (t.startsWith('ytlr-')) counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }

  let tabsLogged = false;
  function logSettingsTabs() {
    const nav = document.querySelector('ytlr-tv-secondary-nav-renderer');
    const data = nav && nav.__instance && nav.__instance.props.data;
    const tabs = data && data.sections && data.sections[0] && data.sections[0].tvSecondaryNavSectionRenderer && data.sections[0].tvSecondaryNavSectionRenderer.tabs;
    if (!tabs || tabsLogged || !tabs.some((t) => t.tabRenderer && t.tabRenderer.content && t.tabRenderer.content.settingBooleanRenderer)) return;
    tabsLogged = true;
    out('tabs', tabs.map((t) => [t.tabRenderer && t.tabRenderer.title, Object.keys((t.tabRenderer && t.tabRenderer.content) || {})]));
    const version = tabs.filter((t) => t.tabRenderer && !t.tabRenderer.votv && t.tabRenderer.content).pop();
    out('lasttab', version);
    out('actiontab', tabs.find((t) => t.tabRenderer && t.tabRenderer.content && t.tabRenderer.content.settingActionRenderer));
  }

  let lastHash = '';
  function tick() {
    logSettingsTabs();
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      out('route', { hash: location.hash, tags: tags() });
    }
    for (const t of TARGETS) {
      const el = document.querySelector(t);
      if (!el) continue;
      const inst = el.__instance;
      const hidden = inst && inst.props && inst.props.isHidden;
      const key = t + '|' + location.hash.split('?')[0] + '|' + (hidden ? 'hidden' : 'shown');
      if (!el || seen.has(key)) continue;
      seen.add(key);
      out('el ' + t, describe(el, DEEP.includes(t)));
    }
  }

  // Remote keys: which codes arrive, and does anything before us stop them?
  ['keydown', 'keyup'].forEach((type) => window.addEventListener(type, (e) => {
    if (type === 'keydown' && e.keyCode !== 174 && e.keyCode !== 175) votv.log(`probe key ${e.keyCode} key=${e.key} code=${e.code} target=${e.target && e.target.tagName}`);
    if (type === 'keydown' && e.keyCode === 13) {
      const rows = [];
      document.querySelectorAll('ytlr-player-actions-container *').forEach((el) => {
        const i = el.__instance;
        if (!i || !i.props) return;
        const d = i.props.data;
        const dk = d && typeof d === 'object' ? Object.keys(d).slice(0, 8).join('|') : typeof d;
        const vb = d && (d.votvButton || (d.buttonRenderer && d.buttonRenderer.votvButton));
        if (i.props.focused || vb) rows.push(`${el.tagName.toLowerCase()} f=${i.props.focused} vb=${vb || ''} data=${dk} cls=${el.className}`);
      });
      votv.log('probe enter-focus ' + JSON.stringify(rows));
    }
  }, true));

  // Where do player responses come from (JSON.parse / Response.json)?
  if (votv.hooks) {
    votv.hooks.json((o) => {
      const keys = Object.keys(o);
      const interesting = ['playabilityStatus', 'streamingData', 'adPlacements', 'playerAds', 'adSlots', 'playerResponse', 'videoDetails']
        .filter((k) => k in o || (o.playerResponse && k in o.playerResponse));
      if (interesting.length) votv.log(`probe json ${interesting.join(',')} keys=${keys.slice(0, 15).join(',')}`);
    });
  }
  votv.log('probe: running');
  setInterval(() => { try { tick(); } catch (e) { votv.error('probe failed', e); } }, 2000);
  return { describe, tags };
});
