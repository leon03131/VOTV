/* VOTV panel: our own menu that slides in from the right over the player. Plugins add
 * sections made of rows (toggle, select, chips, button, info, group); the panel handles the
 * remote (arrows, Enter, Back) itself while it is open. Built with DOM APIs only (the page
 * runs under Trusted Types: no innerHTML strings). Third part of the core. */
(function () {
  'use strict';
  const votv = window.__votv;
  if (!votv || !votv.ui || votv.ui.panel) return;

  const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 27 };
  const sections = []; // {id, order, title, rows: () => Row[]}
  let root = null, list = null, open = false, focusId = null, expanded = new Set(), lastKeyAt = 0;

  // ---- styles -------------------------------------------------------------------------
  const CSS = `
  #votv-panel{--u:calc(100vw/1920);position:fixed;inset:0;z-index:2147483600;pointer-events:none;font-family:"YouTube Sans",Roboto,Arial,sans-serif;color:#f1f1f1}
  #votv-panel .vp-shade{position:absolute;inset:0;background:rgba(0,0,0,.68);opacity:0;transition:opacity .2s cubic-bezier(.2,.8,.2,1)}
  #votv-panel .vp-card{position:absolute;top:calc(32*var(--u));right:calc(32*var(--u));bottom:calc(32*var(--u));width:calc(760*var(--u));display:flex;flex-direction:column;
    background:rgba(20,20,20,.96);border:calc(1*var(--u)) solid rgba(255,255,255,.08);border-radius:calc(24*var(--u));
    box-shadow:0 calc(20*var(--u)) calc(60*var(--u)) rgba(0,0,0,.6);
    transform:translateX(calc(820*var(--u)));transition:transform .22s cubic-bezier(.2,.8,.2,1);overflow:hidden}
  #votv-panel.vp-open .vp-shade{opacity:1}
  #votv-panel.vp-open .vp-card{transform:none}
  #votv-panel .vp-head{display:flex;align-items:center;gap:calc(20*var(--u));padding:calc(36*var(--u)) calc(40*var(--u)) calc(20*var(--u))}
  #votv-panel .vp-logo{width:calc(64*var(--u));height:calc(64*var(--u));border-radius:calc(16*var(--u));flex:none;
    background:#242424;border:calc(1*var(--u)) solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center}
  #votv-panel .vp-logo svg{width:calc(40*var(--u));height:calc(40*var(--u))}
  #votv-panel .vp-title{font-size:calc(36*var(--u));font-weight:600;line-height:1.15;color:#f1f1f1}
  #votv-panel .vp-sub{font-size:calc(22*var(--u));color:rgba(255,255,255,.56);margin-top:calc(4*var(--u));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(560*var(--u))}
  #votv-panel .vp-list{flex:1;overflow:hidden;padding:calc(8*var(--u)) calc(32*var(--u)) 0;position:relative}
  #votv-panel .vp-scroll{padding-bottom:calc(28*var(--u));transition:transform .18s cubic-bezier(.2,.8,.2,1)}
  #votv-panel .vp-sec{margin-top:calc(24*var(--u))}
  #votv-panel .vp-sec:first-child{margin-top:calc(8*var(--u))}
  #votv-panel .vp-sec-title{font-size:calc(22*var(--u));font-weight:500;color:rgba(255,255,255,.48);
    padding:0 calc(12*var(--u)) calc(8*var(--u))}
  #votv-panel .vp-box{background:rgba(255,255,255,.05);border:calc(1*var(--u)) solid rgba(255,255,255,.06);border-radius:calc(16*var(--u));padding:calc(8*var(--u))}
  #votv-panel .vp-row{display:flex;align-items:center;gap:calc(16*var(--u));min-height:calc(72*var(--u));padding:calc(12*var(--u)) calc(20*var(--u));
    border-radius:calc(12*var(--u));transition:background-color .14s cubic-bezier(.2,.8,.2,1),color .14s cubic-bezier(.2,.8,.2,1)}
  #votv-panel .vp-row+.vp-row{margin-top:calc(4*var(--u))}
  #votv-panel .vp-row .vp-text{flex:1;min-width:0}
  #votv-panel .vp-label{font-size:calc(28*var(--u));font-weight:500;line-height:1.25;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:calc(10*var(--u))}
  #votv-panel .vp-dot{width:calc(8*var(--u));height:calc(8*var(--u));border-radius:50%;background:#e53935;flex:none}
  #votv-panel .vp-hint{font-size:calc(20*var(--u));color:rgba(255,255,255,.52);margin-top:calc(4*var(--u));font-variant-numeric:tabular-nums}
  #votv-panel .vp-val{font-size:calc(24*var(--u));color:rgba(255,255,255,.68);display:flex;align-items:center;gap:calc(8*var(--u));white-space:nowrap;font-variant-numeric:tabular-nums}
  #votv-panel .vp-chev{width:calc(14*var(--u));height:calc(14*var(--u));border-right:calc(2.5*var(--u)) solid currentColor;border-bottom:calc(2.5*var(--u)) solid currentColor;transform:rotate(45deg);margin:0 calc(6*var(--u)) calc(6*var(--u))}
  #votv-panel .vp-exp .vp-chev{transform:rotate(-135deg);margin-bottom:0;margin-top:calc(6*var(--u))}
  #votv-panel .vp-sw{width:calc(72*var(--u));height:calc(40*var(--u));border-radius:calc(20*var(--u));background:rgba(255,255,255,.18);position:relative;flex:none;transition:background-color .15s cubic-bezier(.2,.8,.2,1)}
  #votv-panel .vp-sw::after{content:"";position:absolute;top:calc(5*var(--u));left:calc(5*var(--u));width:calc(30*var(--u));height:calc(30*var(--u));border-radius:50%;background:#f1f1f1;transition:transform .15s cubic-bezier(.2,.8,.2,1),background-color .15s cubic-bezier(.2,.8,.2,1)}
  #votv-panel .vp-on .vp-sw{background:#f1f1f1}
  #votv-panel .vp-on .vp-sw::after{transform:translateX(calc(32*var(--u)));background:#141414}
  #votv-panel .vp-focus.vp-on .vp-sw{background:#141414}
  #votv-panel .vp-focus.vp-on .vp-sw::after{background:#f1f1f1}
  #votv-panel .vp-opts{margin:calc(4*var(--u)) 0 calc(8*var(--u)) calc(20*var(--u));padding-left:calc(16*var(--u));border-left:calc(2*var(--u)) solid rgba(255,255,255,.16)}
  #votv-panel .vp-opt{min-height:calc(60*var(--u))}
  #votv-panel .vp-opt .vp-label{font-size:calc(26*var(--u))}
  #votv-panel .vp-radio{width:calc(28*var(--u));height:calc(28*var(--u));border-radius:50%;border:calc(2.5*var(--u)) solid rgba(255,255,255,.48);flex:none;position:relative}
  #votv-panel .vp-sel .vp-radio{border-color:#f1f1f1}
  #votv-panel .vp-sel .vp-radio::after{content:"";position:absolute;inset:calc(5*var(--u));border-radius:50%;background:#f1f1f1}
  #votv-panel .vp-chips{display:flex;flex-wrap:wrap;gap:calc(8*var(--u));padding:calc(8*var(--u)) calc(12*var(--u)) calc(12*var(--u))}
  #votv-panel .vp-chip{font-size:calc(24*var(--u));font-weight:500;font-variant-numeric:tabular-nums;padding:calc(12*var(--u)) calc(16*var(--u));border-radius:calc(10*var(--u));background:rgba(255,255,255,.08);border:calc(1*var(--u)) solid transparent;transition:background-color .14s cubic-bezier(.2,.8,.2,1),color .14s cubic-bezier(.2,.8,.2,1),border-color .14s cubic-bezier(.2,.8,.2,1)}
  #votv-panel .vp-chip.vp-sel{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.28)}
  #votv-panel .vp-chips-label{font-size:calc(28*var(--u));font-weight:500;padding:calc(12*var(--u)) calc(20*var(--u)) 0}
  #votv-panel .vp-btn .vp-label{color:#f1f1f1}
  #votv-panel .vp-dis{opacity:.42}
  #votv-panel .vp-focus{background:#f1f1f1 !important;color:#0f0f0f}
  #votv-panel .vp-focus .vp-hint,#votv-panel .vp-focus .vp-val{color:rgba(15,15,15,.64)}
  #votv-panel .vp-focus.vp-btn .vp-label{color:#0f0f0f}
  #votv-panel .vp-focus .vp-radio{border-color:rgba(15,15,15,.55)}
  #votv-panel .vp-focus.vp-sel .vp-radio{border-color:#0f0f0f}
  #votv-panel .vp-focus.vp-sel .vp-radio::after{background:#0f0f0f}
  #votv-panel .vp-chip.vp-focus{background:#f1f1f1 !important;color:#0f0f0f;border-color:#f1f1f1}
  #votv-panel .vp-foot{padding:calc(16*var(--u)) calc(40*var(--u)) calc(28*var(--u));font-size:calc(20*var(--u));color:rgba(255,255,255,.48);display:flex;align-items:center;gap:calc(12*var(--u));border-top:calc(1*var(--u)) solid rgba(255,255,255,.06)}
  #votv-panel .vp-keycap{display:inline-block;padding:calc(2*var(--u)) calc(8*var(--u));border-radius:calc(6*var(--u));background:rgba(255,255,255,.08);border:calc(1*var(--u)) solid rgba(255,255,255,.12);color:rgba(255,255,255,.82);font-size:calc(18*var(--u));font-weight:500}
  `;

  /** The page's CSP blocks <style> elements without its nonce. Constructed stylesheets are
   *  not subject to it; fall back to a <style> carrying the page's own nonce. */
  function injectCss(css) {
    try {
      if (window.CSSStyleSheet && 'adoptedStyleSheets' in document) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        return 'adoptedStyleSheets';
      }
    } catch (e) { /* fall through */ }
    const st = document.createElement('style');
    const withNonce = document.querySelector('script[nonce], style[nonce]');
    if (withNonce && withNonce.nonce) st.nonce = withNonce.nonce;
    st.textContent = css;
    (document.head || document.body).appendChild(st);
    return st.nonce ? 'style+nonce' : 'style';
  }
  votv.ui.injectCss = injectCss;

  // ---- tiny DOM helpers ---------------------------------------------------------------
  function h(tag, cls, kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of [].concat(kids || [])) {
      if (k == null || k === false) continue;
      e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    }
    return e;
  }
  function logo() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    const bubble = document.createElementNS(NS, 'path');
    bubble.setAttribute('fill', '#f1f1f1');
    bubble.setAttribute('d', 'M164 116h184a72 72 0 0 1 72 72v112a72 72 0 0 1-72 72H230l-74 58a10 10 0 0 1-16-9l8-49a72 72 0 0 1-56-70V188a72 72 0 0 1 72-72z');
    const play = document.createElementNS(NS, 'path');
    play.setAttribute('fill', '#e53935');
    play.setAttribute('d', 'M172 196.5c0-13 14-21 25.3-14.5l78 45c11.2 6.5 11.2 22.5 0 29l-78 45c-11.3 6.5-25.3-1.5-25.3-14.5z');
    svg.appendChild(bubble);
    svg.appendChild(play);
    return svg;
  }

  // ---- model -> DOM -------------------------------------------------------------------
  // Every focusable gets {id, el, row (navigation row key), act(key) -> handled}.
  let focusables = [];
  let renderedSignature = '';
  const val = (x) => (typeof x === 'function' ? x() : x);
  // Evaluate display data only; event callbacks must never run during a refresh.
  function snapshot(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith('on')) continue;
      out[key] = key === 'rows' ? (val(value) || []).map(snapshot) : val(value);
    }
    return out;
  }
  const optLabel = (r) => { const v = val(r.value); const o = (val(r.options) || []).find((x) => x[0] === v); return o ? o[1] : (v == null ? '' : String(v)); };

  function addFocusable(id, el, rowKey, act) { focusables.push({ id, el, row: rowKey, act }); el.dataset.vpId = id; }

  function renderRow(sec, r, i, box, prefix) {
    const id = `${prefix}${sec.id}.${r.id || i}`;
    const disabled = !!val(r.disabled);
    const hint = val(r.hint);
    const labelNode = h('div', 'vp-label', [r.kind === 'toggle' && val(r.value) ? h('span', 'vp-dot') : null, val(r.label)]);
    const text = h('div', 'vp-text', [labelNode, hint ? h('div', 'vp-hint', hint) : null]);
    if (r.kind === 'toggle') {
      const on = !!val(r.value);
      const row = h('div', `vp-row${on ? ' vp-on' : ''}${disabled ? ' vp-dis' : ''}`, [text, h('div', 'vp-sw')]);
      box.appendChild(row);
      addFocusable(id, row, id, (k) => {
        if (k !== KEY.ENTER || disabled) return false;
        r.onChange(!on); return true;
      });
    } else if (r.kind === 'select') {
      const isOpen = expanded.has(id);
      const row = h('div', `vp-row${isOpen ? ' vp-exp' : ''}${disabled ? ' vp-dis' : ''}`, [text, h('div', 'vp-val', [optLabel(r), h('div', 'vp-chev')])]);
      box.appendChild(row);
      addFocusable(id, row, id, (k) => {
        if (k !== KEY.ENTER || disabled) return false;
        if (isOpen) expanded.delete(id); else {
          // Keep enclosing groups expanded when opening a nested selector.
          for (const key of expanded) if (!id.startsWith(`${key}/`)) expanded.delete(key);
          expanded.add(id);
        }
        return true;
      });
      if (isOpen) {
        const opts = h('div', 'vp-opts');
        const cur = val(r.value);
        (val(r.options) || []).forEach(([v, label], j) => {
          const o = h('div', `vp-row vp-opt${v === cur ? ' vp-sel' : ''}`, [h('div', 'vp-text', [h('div', 'vp-label', label)]), h('div', 'vp-radio')]);
          opts.appendChild(o);
          const oid = `${id}#${j}`;
          addFocusable(oid, o, oid, (k) => {
            if (k === KEY.ENTER) { expanded.delete(id); focusId = id; r.onChange(v); return true; }
            if (k === KEY.BACK || k === KEY.LEFT) { expanded.delete(id); focusId = id; return true; }
            return false;
          });
          if (v === cur && focusId === id) focusId = oid; // entering the list: start on the current value
        });
        box.appendChild(opts);
      }
    } else if (r.kind === 'chips') {
      const wrap = h('div', '', [h('div', 'vp-chips-label', val(r.label))]);
      const chips = h('div', 'vp-chips');
      const cur = val(r.value);
      (val(r.options) || []).forEach(([v, label], j) => {
        const c = h('div', `vp-chip${v === cur ? ' vp-sel' : ''}`, label);
        chips.appendChild(c);
        addFocusable(`${id}#${j}`, c, id, (k) => { if (k !== KEY.ENTER) return false; r.onChange(v); return true; });
      });
      wrap.appendChild(chips);
      box.appendChild(wrap);
    } else if (r.kind === 'button') {
      const row = h('div', `vp-row vp-btn${disabled ? ' vp-dis' : ''}`, [text, val(r.value) ? h('div', 'vp-val', val(r.value)) : null]);
      box.appendChild(row);
      addFocusable(id, row, id, (k) => { if (k !== KEY.ENTER || disabled) return false; r.onPress(); return true; });
    } else if (r.kind === 'group') {
      const isOpen = expanded.has(id) || r.open;
      const row = h('div', `vp-row${isOpen ? ' vp-exp' : ''}`, [text, h('div', 'vp-val', [val(r.value) || '', h('div', 'vp-chev')])]);
      box.appendChild(row);
      addFocusable(id, row, id, (k) => {
        if (k !== KEY.ENTER) return false;
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        return true;
      });
      if (isOpen) {
        const sub = h('div', 'vp-opts');
        (val(r.rows) || []).forEach((sr, j) => renderRow(sec, sr, `${i}.${j}`, sub, `${id}/`));
        box.appendChild(sub);
      }
    } else { // info
      box.appendChild(h('div', `vp-row${disabled ? ' vp-dis' : ''}`, [text, val(r.value) ? h('div', 'vp-val', val(r.value)) : null]));
    }
  }

  function render() {
    if (!root) return;
    const ordered = sections.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const models = ordered.map((sec) => {
      try { return { sec, rows: val(sec.rows) || [] }; }
      catch (e) { votv.error('panel section', sec.id, e); return { sec, rows: [] }; }
    });
    const subtitle = panel.subtitle();
    const signature = JSON.stringify([subtitle, [...expanded], models.map(({ sec, rows }) => [sec.id, val(sec.title), rows.map(snapshot)])]);
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    const card = root.querySelector('.vp-card');
    const prevScroll = card ? card.querySelector('.vp-scroll') : null;
    focusables = [];
    const scroll = h('div', 'vp-scroll');
    for (const { sec, rows } of models) {
      if (!rows.length) continue;
      const box = h('div', 'vp-box');
      rows.forEach((r, i) => { try { renderRow(sec, r, i, box, ''); } catch (e) { votv.error('panel row', sec.id, e); } });
      scroll.appendChild(h('div', 'vp-sec', [sec.title ? h('div', 'vp-sec-title', val(sec.title)) : null, box]));
    }
    list.textContent = '';
    list.appendChild(scroll);
    if (prevScroll && prevScroll.style.transform) scroll.style.transform = prevScroll.style.transform;
    const sub = root.querySelector('.vp-sub');
    if (sub && sub.textContent !== subtitle) sub.textContent = subtitle;
    if (!focusables.some((f) => f.id === focusId)) {
      // start on the first row; in a chips row, on the selected chip
      const first = focusables[0];
      const sel = first && focusables.find((f) => f.row === first.row && f.el.classList.contains('vp-sel'));
      focusId = (sel || first || {}).id || null;
    }
    paintFocus();
  }

  function paintFocus() {
    for (const f of focusables) f.el.classList.toggle('vp-focus', f.id === focusId);
    const cur = focusables.find((f) => f.id === focusId);
    if (!cur) return;
    // keep the focused row visible: translate the content instead of scrolling (TV-friendly)
    const scroll = list.querySelector('.vp-scroll');
    const viewH = list.clientHeight;
    const maxOffset = Math.max(0, scroll.scrollHeight - viewH);
    const firstRow = focusables[0] && focusables[0].row;
    const lastRow = focusables[focusables.length - 1] && focusables[focusables.length - 1].row;
    const m = /translateY\((-?[\d.]+)px\)/.exec(scroll.style.transform || '');
    let offset = m ? -parseFloat(m[1]) : 0;
    if (cur.row === firstRow) {
      offset = 0;
    } else if (cur.row === lastRow) {
      offset = maxOffset;
    } else {
      const top = cur.el.offsetTop, bottom = top + cur.el.offsetHeight;
      let parent = cur.el.offsetParent, t = top, b = bottom;
      while (parent && parent !== scroll && parent !== list) { t += parent.offsetTop; b += parent.offsetTop; parent = parent.offsetParent; }
      const margin = viewH * 0.18;
      if (t - offset < margin) offset = Math.max(0, t - margin);
      else if (b - offset > viewH - margin) offset = Math.min(maxOffset, b - viewH + margin);
    }
    scroll.style.transform = `translateY(${-offset}px)`;
  }

  // ---- navigation ---------------------------------------------------------------------
  function move(k) {
    const i = focusables.findIndex((f) => f.id === focusId);
    if (i < 0) { focusId = focusables[0] && focusables[0].id; return; }
    const cur = focusables[i];
    if (k === KEY.LEFT || k === KEY.RIGHT) {
      const same = focusables.filter((f) => f.row === cur.row);
      const j = same.indexOf(cur) + (k === KEY.RIGHT ? 1 : -1);
      if (j >= 0 && j < same.length) focusId = same[j].id;
      return;
    }
    // UP/DOWN: to the nearest focusable in the previous/next navigation row
    const step = k === KEY.DOWN ? 1 : -1;
    for (let j = i + step; j >= 0 && j < focusables.length; j += step) {
      if (focusables[j].row !== cur.row) {
        const row = focusables.filter((f) => f.row === focusables[j].row);
        const col = focusables.filter((f) => f.row === cur.row).indexOf(cur);
        focusId = (row[Math.min(col, row.length - 1)] || focusables[j]).id;
        return;
      }
    }
  }

  function onKey(e) {
    if (!open) return;
    const k = e.keyCode;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== 'keydown') return;
    const now = Date.now();
    if (now - lastKeyAt < 60) return; // remote repeat storm
    lastKeyAt = now;
    const cur = focusables.find((f) => f.id === focusId);
    if (cur && cur.act(k)) { render(); return; }
    if (k === KEY.BACK) {
      if (expanded.size) { expanded.clear(); render(); return; }
      panel.close();
      return;
    }
    if ([KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT].includes(k)) { move(k); paintFocus(); }
  }
  ['keydown', 'keyup', 'keypress'].forEach((t) => window.addEventListener(t, onKey, true));

  // ---- public API ---------------------------------------------------------------------
  const panel = {
    /** Add a section: {id, order, title, rows: () => Row[]}. Rows:
     *  {kind:'toggle', label, hint, value: () => bool, onChange(bool), disabled}
     *  {kind:'select', label, hint, value, options: [[value, label]], onChange(value)}
     *  {kind:'chips', label, value, options, onChange(value)}
     *  {kind:'button', label, hint, value, onPress()}
     *  {kind:'info', label, hint, value}
     *  {kind:'group', label, hint, value, rows: Row[]} (expands in place) */
    section(s) { if (!sections.some((x) => x.id === s.id)) sections.push(s); if (open) render(); },
    subtitle: () => '',
    isOpen: () => open,
    open() {
      if (open) return;
      if (!root) {
        injectCss(CSS);
        list = h('div', 'vp-list');
        root = h('div', '', [
          h('div', 'vp-shade'),
          h('div', 'vp-card', [
            h('div', 'vp-head', [h('div', 'vp-logo', [logo()]), h('div', '', [h('div', 'vp-title', 'VOTV'), h('div', 'vp-sub', '')])]),
            list,
            h('div', 'vp-foot', [
              h('span', 'vp-keycap', 'OK'), h('span', '', 'выбрать'),
              h('span', 'vp-keycap', 'Назад'), h('span', '', 'закрыть'),
            ]),
          ]),
        ]);
        root.id = 'votv-panel';
        document.body.appendChild(root);
      }
      open = true;
      renderedSignature = '';
      expanded.clear();
      focusId = null;
      render();
      // next frame: slide in
      requestAnimationFrame(() => { if (open) root.classList.add('vp-open'); });
    },
    close() {
      if (!open) return;
      open = false;
      root.classList.remove('vp-open');
    },
    /** Re-render if open (call after state changes that rows display). */
    refresh() { if (open) render(); },
  };

  // refresh live values (current segment, counters) while open
  setInterval(() => { if (open) render(); }, 1000);

  votv.ui.panel = panel;
})();
