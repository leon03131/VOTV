/* VOTV core UI: settings, the YouTube settings section, the player button and popups,
 * player state and response hooks. Second part of the core (after core.js).
 *
 * youtube.com/tv is served by Google and its internal names are minified and change with
 * web releases, so nothing here relies on a minified name: methods are found by what they do
 * (their source shape or their return value). Data objects (tabRenderer, buttonRenderer, ...)
 * are YouTube's public renderer JSON and are stable. */
(function () {
  'use strict';
  const votv = window.__votv;
  if (!votv || votv.ui) return;

  const PREFIX = 'VOTV_';
  const text = (s) => ({ runs: [{ text: String(s) }] });
  const simple = (s) => ({ simpleText: String(s) });

  // ---- components ---------------------------------------------------------------------
  const instanceOf = (el) => (el && el.__instance) || null;

  /** Force a component to re-render. Found by source: the base-class method that sets
   *  `{x: true, y: this.state}` and schedules a render (Da() in 2026 builds). Cached per prototype. */
  const renderCache = new WeakMap();
  function forceUpdate(inst) {
    if (!inst) return false;
    let proto = Object.getPrototypeOf(inst);
    if (!renderCache.has(proto)) {
      let found = null;
      for (let p = proto; p && p !== Object.prototype && !found; p = Object.getPrototypeOf(p)) {
        for (const k of Object.getOwnPropertyNames(p)) {
          const d = Object.getOwnPropertyDescriptor(p, k);
          if (!d || typeof d.value !== 'function' || d.value.length !== 0) continue;
          if (/^[\w$]+\(\)\{this\.[\w$]+=\{[\w$]+:!0,[\w$]+:this\.state\};[\w$.]+\(this\)\}$/.test(String(d.value))) { found = k; break; }
        }
      }
      renderCache.set(proto, found);
      if (!found) votv.warn('ui: no re-render method found on', inst.constructor && inst.constructor.name);
    }
    const name = renderCache.get(proto);
    if (!name) return false;
    inst[name]();
    return true;
  }

  // ---- settings -----------------------------------------------------------------------
  const defs = [];           // {id, type: 'bool'|'choice'|'info', title, summary, default, options, group}
  const listeners = new Map();
  const values = votv.storage.get('settings', {}) || {};

  const settings = {
    define(def) {
      if (!def || !def.id || defs.some((d) => d.id === def.id)) return settings;
      defs.push(Object.assign({ type: 'bool', group: 'VOTV' }, def));
      ui.refresh();
      return settings;
    },
    get(id) {
      if (Object.prototype.hasOwnProperty.call(values, id)) return values[id];
      const d = defs.find((x) => x.id === id);
      return d ? d.default : undefined;
    },
    set(id, value) {
      if (settings.get(id) === value) return;
      values[id] = value;
      votv.storage.set('settings', values);
      (listeners.get(id) || []).forEach((fn) => { try { fn(value); } catch (e) { votv.error('setting listener', id, e); } });
      playerSignature = '';
      try { updateValues(); } catch (e) { votv.error('ui update', e); }
    },
    onChange(id, fn) {
      if (!listeners.has(id)) listeners.set(id, []);
      listeners.get(id).push(fn);
    },
    list: () => defs.slice(),
  };

  // ---- actions (what our menu rows and buttons do) ------------------------------------
  // Rows carry a `votvAction` field in their renderer data; YouTube ignores unknown fields.
  const handlers = new Map(); // action.type -> fn(action)
  let lastAction = '', lastActionAt = 0;
  function runAction(action) {
    const stamp = JSON.stringify(action), now = Date.now();
    if (stamp === lastAction && now - lastActionAt < 300) return; // click + keydown for one press
    lastAction = stamp; lastActionAt = now;
    const h = handlers.get(action.type);
    if (h) { try { h(action); } catch (e) { votv.error('action', action.type, e); } }
    else votv.warn('ui: no handler for action', action.type);
  }
  // Closing a popup makes YouTube rebuild the settings page from its own data (selection back
  // at the top). Remember which of our rows the popup came from to select it again.
  let restore = null; // {itemId, until}
  handlers.set('setting', (a) => {
    restore = { itemId: PREFIX + a.id, until: Date.now() + 5000 };
    settings.set(a.id, a.value);
  });
  handlers.set('toast', (a) => votv.toast(a.text, a.ms));
  handlers.set('noop', () => {});

  /** YouTube command that opens a popup list (the same overlay YouTube uses for its menus). */
  function popup(title, rows, subtitle) {
    const items = rows.map((r) => ({
      compactLinkRenderer: {
        title: simple(r.label),
        subtitle: r.subtitle ? simple(r.subtitle) : undefined,
        secondaryIcon: r.selected === undefined ? undefined : { iconType: r.selected ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED' },
        votvAction: r.action,
        serviceEndpoint: { signalAction: { signal: 'POPUP_BACK' } },
      },
    }));
    return {
      openPopupAction: {
        popup: {
          overlaySectionRenderer: {
            dismissalCommand: { signalAction: { signal: 'POPUP_BACK' } },
            overlay: {
              overlayPanelRenderer: {
                header: { overlayPanelHeaderRenderer: { title: simple(title), subtitle: simple(subtitle || '') } },
                content: { overlayPanelItemListRenderer: { items } },
              },
            },
          },
        },
      },
    };
  }

  function choicePopup(def) {
    const cur = settings.get(def.id);
    return popup(def.title, def.options.map(([value, label]) => ({
      label, selected: value === cur, action: { type: 'setting', id: def.id, value },
    })), def.summary);
  }

  const optionLabel = (def) => {
    const v = settings.get(def.id);
    const o = (def.options || []).find((x) => x[0] === v);
    return o ? o[1] : String(v);
  };

  // ---- the VOTV section in YouTube's settings -----------------------------------------
  const isSettingsNav = (tabs) => tabs.some((t) => {
    const c = t && t.tabRenderer && t.tabRenderer.content;
    return c && (c.settingBooleanRenderer || c.settingsPaneRenderer || c.settingSingleOptionMenuRenderer);
  });

  function ourTabs() {
    const tabs = [];
    const groups = [...new Set(defs.map((d) => d.group || 'VOTV'))];
    for (const d of groups.flatMap((g) => defs.filter((x) => (x.group || 'VOTV') === g))) {
      const itemId = PREFIX + d.id;
      const group = d.group || 'VOTV';
      if (!tabs.some((t) => t.tabRenderer.votvGroup === group)) {
        tabs.push({ tabRenderer: { title: group, unselectable: true, votv: true, votvGroup: group } });
      }
      if (d.type === 'bool') {
        tabs.push({ tabRenderer: { title: d.title, selected: false, votv: true, content: { settingBooleanRenderer: {
          itemId, title: text(d.title), summary: text(d.summary || ''), enabled: !!settings.get(d.id),
          enableServiceEndpoint: {}, disableServiceEndpoint: {},
        } } } });
      } else if (d.type === 'choice') {
        tabs.push({ tabRenderer: { title: d.title, selected: false, votv: true, content: { settingSingleOptionMenuRenderer: {
          itemId, title: simple(d.title),
          summary: d.summary ? simple(d.summary) : undefined,
          button: { buttonRenderer: { text: simple(optionLabel(d)), command: {} } },
        } } } });
      } else if (d.type === 'info') {
        // settingActionRenderer: title, summary text and one button (YouTube's read-only rows
        // render their pane from built-in client code, so they can't show our text).
        const desc = typeof d.description === 'function' ? d.description() : d.description;
        const heading = typeof d.heading === 'function' ? d.heading() : (d.heading || d.title);
        tabs.push({ tabRenderer: { title: d.title, selected: false, votv: true, content: { settingActionRenderer: {
          itemId, title: text(heading), summary: text(desc || ''),
          actionLabel: text(d.actionLabel || 'OK'), votvAction: d.action || { type: 'noop' },
          serviceEndpoint: {},
        } } } });
      }
    }
    return tabs;
  }

  // Inject our tabs once per settings page (and when plugins define new settings). Value changes
  // never replace the tab list - that would reset the selection - see updateValues().
  let settingsSignature = '';
  function renderSettings() {
    const inst = instanceOf(document.querySelector('ytlr-tv-secondary-nav-renderer'));
    const data = inst && inst.props && inst.props.data;
    const section = data && data.sections && data.sections[0] && data.sections[0].tvSecondaryNavSectionRenderer;
    if (!section || !Array.isArray(section.tabs)) return;
    const base = section.tabs.filter((t) => !(t.tabRenderer && t.tabRenderer.votv));
    if (!isSettingsNav(base)) return;
    const signature = JSON.stringify(defs.map((d) => d.id));
    const has = section.tabs.length !== base.length;
    if (has && signature === settingsSignature) return;
    settingsSignature = signature;
    const sections = data.sections.slice();
    const tabs = base.concat(ourTabs());
    sections[0] = { tvSecondaryNavSectionRenderer: Object.assign({}, section, { tabs }) };
    const next = Object.assign({}, data, { sections });
    if (restore && restore.until > Date.now()) {
      const i = tabs.findIndex((t) => {
        const c = t.tabRenderer && t.tabRenderer.content;
        return c && Object.values(c).some((r) => r && r.itemId === restore.itemId);
      });
      if (i >= 0) {
        tabs.forEach((t, idx) => {
          if (t.tabRenderer && !t.tabRenderer.unselectable) t.tabRenderer.selected = idx === i;
        });
        next.selectedIndex = i;
        inst.props.selectedIndex = i;
        if (typeof inst.setSelectedIndex === 'function') {
          Promise.resolve().then(() => { try { inst.setSelectedIndex(i); } catch (e) {} });
        }
      }
      restore = null;
    }
    inst.props.data = next;
    forceUpdate(inst);
  }

  /** A setting changed: refresh our rows' data in place and re-render only those components. */
  function updateValues() {
    const nav = instanceOf(document.querySelector('ytlr-tv-secondary-nav-renderer'));
    const data = nav && nav.props && nav.props.data;
    const section = data && data.sections && data.sections[0] && data.sections[0].tvSecondaryNavSectionRenderer;
    if (section && Array.isArray(section.tabs)) {
      const fresh = ourTabs();
      for (const tab of section.tabs) {
        const t = tab.tabRenderer;
        if (!t || !t.votv || !t.content) continue;
        const key = Object.keys(t.content)[0];
        const now = fresh.find((f) => f.tabRenderer.content && f.tabRenderer.content[key] && f.tabRenderer.content[key].itemId === t.content[key].itemId);
        if (now) Object.assign(t.content[key], now.tabRenderer.content[key]); // same objects the components hold
      }
    }
    document.querySelectorAll('ytlr-setting-boolean-renderer, ytlr-setting-single-option-menu-renderer, ytlr-setting-action-renderer').forEach((el) => {
      const inst = instanceOf(el);
      const id = inst && inst.props && inst.props.data && inst.props.data.itemId;
      if (id && id.startsWith(PREFIX)) forceUpdate(inst);
    });
    patchChoices();
  }

  // Our boolean rows: YouTube reads their value through endpoints we don't have, so give the
  // component the value directly and handle on/off presses ourselves.
  function patchBooleans() {
    document.querySelectorAll('ytlr-setting-boolean-renderer').forEach((el) => {
      const inst = instanceOf(el);
      const itemId = inst && inst.props && inst.props.data && inst.props.data.itemId;
      if (!itemId || !itemId.startsWith(PREFIX) || inst.__votv === itemId) return;
      inst.__votv = itemId;
      const id = itemId.slice(PREFIX.length);
      Object.defineProperty(inst, 'enabled', { get: () => !!settings.get(id), configurable: true });
      forceUpdate(inst);
    });
  }

  function focusedBoolean() {
    for (const el of document.querySelectorAll('ytlr-setting-boolean-renderer')) {
      const inst = instanceOf(el);
      if (inst && inst.__votv && inst.props.focused) return inst;
    }
    return null;
  }

  // Our choice rows: render inline selectable option pills directly inside YouTube's
  // settingSingleOptionMenuRenderer right pane (matching settingBooleanRenderer) instead of
  // opening a fullscreen popup that resets left-list focus on close.
  const CHOICE_CSS = `
  ytlr-setting-single-option-menu-renderer[data-votv-choice="1"]{--vu:calc(100vw/1920);position:relative !important}
  ytlr-setting-single-option-menu-renderer[data-votv-choice="1"] > yt-focus-container,
  ytlr-setting-single-option-menu-renderer[data-votv-choice="1"] > ytlr-button,
  ytlr-setting-single-option-menu-renderer[data-votv-choice="1"] [data-votv-hidden-btn="1"]{position:absolute !important;left:50% !important;top:calc(396*var(--vu)) !important;transform:translateX(-50%) !important;margin:0 !important;opacity:0 !important;pointer-events:none !important}
  .votv-choice-list{display:flex;flex-direction:column;gap:calc(12*var(--vu));margin:calc(90*var(--vu)) auto 0;align-self:center;width:calc(625*var(--vu));max-width:100%;max-height:calc(540*var(--vu));overflow-y:auto;padding:0}
  .votv-choice-pill{box-sizing:border-box;width:100%;min-height:calc(96*var(--vu));padding:calc(16*var(--vu)) calc(52*var(--vu)) calc(16*var(--vu)) calc(60*var(--vu));border-radius:9999px;display:flex;align-items:center;justify-content:space-between;gap:calc(16*var(--vu));background:#272727;color:#f1f1f1;font-family:"YouTube Sans",Roboto,Arial,sans-serif;font-size:calc(28*var(--vu));font-weight:500;line-height:1.25;transition:background-color .12s cubic-bezier(.2,.8,.2,1),color .12s cubic-bezier(.2,.8,.2,1)}
  .votv-choice-pill.vp-focus{background:#f1f1f1;color:#0f0f0f}
  .votv-choice-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
  .votv-choice-check{flex:none;width:calc(28*var(--vu));height:calc(28*var(--vu));display:inline-flex;align-items:center;justify-content:center;visibility:hidden}
  .votv-choice-pill.vp-selected .votv-choice-check{visibility:visible}
  `;
  let choiceCssDone = false;
  function ensureChoiceCss() {
    if (choiceCssDone || typeof document === 'undefined') return;
    choiceCssDone = true;
    if (ui.injectCss) { try { ui.injectCss(CHOICE_CSS); return; } catch (e) {} }
    try {
      if (window.CSSStyleSheet && 'adoptedStyleSheets' in document) {
        const s = new CSSStyleSheet();
        s.replaceSync(CHOICE_CSS);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
        return;
      }
    } catch (e) {}
    if (document.head || document.body) {
      const s = document.createElement('style');
      s.textContent = CHOICE_CSS;
      (document.head || document.body).appendChild(s);
    }
  }

  const choiceCursors = new Map();
  const choicePrevFocused = new Map();
  const choiceBoxes = new WeakMap();

  function makeCheckmark() {
    const chk = document.createElement('span');
    chk.className = 'votv-choice-check';
    if (typeof document.createElementNS === 'function') {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.style.cssText = 'width:100%;height:100%;display:block';
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M5 12.5l4.5 4.5 9.5-9.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2.6');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      chk.appendChild(svg);
    } else {
      chk.textContent = '✓';
    }
    return chk;
  }

  function patchChoices() {
    for (const el of document.querySelectorAll('ytlr-setting-single-option-menu-renderer')) {
      const inst = instanceOf(el);
      const itemId = inst && inst.props && inst.props.data && inst.props.data.itemId;
      if (!itemId || !itemId.startsWith(PREFIX)) continue;
      const id = itemId.slice(PREFIX.length);
      const def = defs.find((d) => d.id === id);
      if (!def || def.type !== 'choice' || !Array.isArray(def.options) || !def.options.length) continue;

      ensureChoiceCss();
      if (el.setAttribute && (!el.getAttribute || el.getAttribute('data-votv-choice') !== '1')) {
        el.setAttribute('data-votv-choice', '1');
      }
      const btnWrap = el.querySelector && (
        el.querySelector('yt-focus-container') || el.querySelector('ytlr-button')
        || el.querySelector('[role="button"]') || el.querySelector('[idomkey="button"]') || el.querySelector('.o1D9g')
      );
      if (btnWrap && btnWrap.setAttribute && (!btnWrap.getAttribute || btnWrap.getAttribute('data-votv-hidden-btn') !== '1')) {
        btnWrap.setAttribute('data-votv-hidden-btn', '1');
      }

      const focused = !!inst.props.focused;
      const curVal = settings.get(id);
      const curIdx = Math.max(0, def.options.findIndex((o) => o[0] === curVal));
      if (!focused || !choicePrevFocused.get(id)) {
        choiceCursors.set(id, curIdx);
      }
      choicePrevFocused.set(id, focused);
      const cursor = Math.max(0, Math.min(def.options.length - 1, choiceCursors.has(id) ? choiceCursors.get(id) : curIdx));

      let entry = choiceBoxes.get(el);
      const sig = JSON.stringify([id, curVal, focused ? cursor : -1, def.options]);
      if (!entry) {
        const box = document.createElement('div');
        box.className = 'votv-choice-list';
        entry = { box, sig: '' };
        choiceBoxes.set(el, entry);
      }
      if (entry.box.parentNode !== el && typeof el.appendChild === 'function') {
        el.appendChild(entry.box);
      }
      if (entry.sig === sig) continue;
      entry.sig = sig;

      if (entry.box.replaceChildren) entry.box.replaceChildren();
      else if (entry.box.children) while (entry.box.children.length) entry.box.children[0].remove();

      def.options.forEach(([val, lbl], idx) => {
        const pill = document.createElement('div');
        const isSel = val === curVal;
        const isFoc = focused && idx === cursor;
        pill.className = `votv-choice-pill${isSel ? ' vp-selected' : ''}${isFoc ? ' vp-focus' : ''}`;
        if (pill.dataset) { pill.dataset.votvChoice = id; pill.dataset.votvIdx = String(idx); }

        const span = document.createElement('span');
        span.className = 'votv-choice-label';
        span.textContent = lbl;

        pill.appendChild(span);
        pill.appendChild(makeCheckmark());
        entry.box.appendChild(pill);
        if (isFoc && typeof pill.scrollIntoView === 'function') {
          try { pill.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        }
      });
    }
  }

  function focusedChoice() {
    for (const el of document.querySelectorAll('ytlr-setting-single-option-menu-renderer')) {
      const inst = instanceOf(el);
      const itemId = inst && inst.props && inst.props.data && inst.props.data.itemId;
      if (inst && itemId && itemId.startsWith(PREFIX) && inst.props && inst.props.focused) {
        const id = itemId.slice(PREFIX.length);
        const def = defs.find((d) => d.id === id);
        if (def && def.type === 'choice' && Array.isArray(def.options) && def.options.length) {
          return { el, inst, id, def };
        }
      }
    }
    return null;
  }

  // ---- the player button --------------------------------------------------------------
  const buttons = []; // {id, label(), icon, menu() -> {title, subtitle, rows}}

  /** Own zero-arg function of the actions container that builds the right-hand button group
   *  (captions, settings): it calls the function that reads `settingActions` and returns an array. */
  function findButtonsBuilder(inst) {
    const fns = Object.keys(inst).filter((k) => typeof inst[k] === 'function' && inst[k].length === 0);
    const reader = fns.find((k) => String(inst[k]).includes('settingActions'));
    if (!reader) return null;
    const call = `this.${reader}()`;
    for (const k of fns) {
      if (k === reader || !String(inst[k]).includes(call)) continue;
      try { if (Array.isArray(inst[k].call(inst))) return k; } catch (e) { /* not it */ }
    }
    return null;
  }

  const visibleButtons = () => buttons.filter((b) => !b.enabled || b.enabled());

  function buttonItem(b) {
    const label = typeof b.label === 'function' ? b.label() : b.label;
    let command = {};
    if (b.menu) { const m = b.menu(); command = popup(m.title, m.rows, m.subtitle); }
    return {
      type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_' + PREFIX + b.id.toUpperCase(),
      button: { buttonRenderer: {
        isDisabled: false, text: text(label), icon: { iconType: b.icon || 'TRANSLATE' },
        accessibilityData: { accessibilityData: { label } },
        command, votvButton: b.id, // b.onPress: we handle the press ourselves (focusedButton)
      } },
    };
  }

  /** Our player button that has the remote's focus right now, if any. */
  function focusedButton() {
    for (const el of document.querySelectorAll('ytlr-player-actions-container *')) {
      const inst = el.__instance;
      const d = inst && inst.props && inst.props.data;
      const id = d && (d.votvButton || (d.buttonRenderer && d.buttonRenderer.votvButton));
      if (!id) continue; // most descendants are plain elements without an instance
      // Focus shows as props.focused or as the framework's .zylon-focus class (on the button
      // or an inner element).
      const focused = inst.props.focused || el.classList.contains('zylon-focus') || !!el.querySelector('.zylon-focus');
      if (focused) return buttons.find((b) => b.id === id) || null;
    }
    return null;
  }

  let playerSignature = '';
  function renderPlayer() {
    const el = document.querySelector('ytlr-player-actions-container');
    const inst = instanceOf(el);
    if (!inst || !buttons.length) return;
    if (!inst.__votvBuilder) {
      const key = findButtonsBuilder(inst);
      if (!key) return;
      const original = inst[key];
      inst.__votvBuilder = key;
      inst[key] = function () {
        const items = original.apply(this, arguments);
        if (!Array.isArray(items) || !items.length) return items; // controls hidden
        const out = items.slice();
        const i = out.findIndex((x) => /CAPTIONS$/.test(x && x.type));
        out.splice(i < 0 ? 0 : i + 1, 0, ...visibleButtons().map(buttonItem));
        return out;
      };
      playerSignature = '';
    }
    const signature = JSON.stringify([visibleButtons().map((b) => [b.id, typeof b.label === 'function' ? b.label() : b.label]), values]);
    if (signature !== playerSignature) {
      playerSignature = signature;
      forceUpdate(inst);
    }
  }

  // ---- presses ------------------------------------------------------------------------
  function actionAt(node) {
    for (let e = node; e; e = e.parentElement) {
      const inst = e.__instance;
      const a = inst && inst.props && inst.props.data && inst.props.data.votvAction;
      if (a) return a;
    }
    return null;
  }

  function focusedAction() {
    for (const el of document.querySelectorAll('ytlr-compact-link-renderer, ytlr-setting-action-renderer')) {
      const inst = instanceOf(el);
      if (inst && inst.props && inst.props.focused && inst.props.data && inst.props.data.votvAction) return inst.props.data.votvAction;
    }
    return null;
  }

  function onBooleanPress(inst) {
    const side = inst.state && inst.state.pa; // focused half: 'on' | 'off'
    if (side !== 'on' && side !== 'off') return false;
    settings.set(inst.__votv.slice(PREFIX.length), side === 'on');
    forceUpdate(inst);
    return true;
  }

  const isEnter = (e) => e.keyCode === 13 || e.keyCode === 23 || e.key === 'Enter';
  let swallowEnterUp = false;
  const swallowedKeys = new Set();
  window.addEventListener('keyup', (e) => {
    if (swallowedKeys.has(e.keyCode)) { swallowedKeys.delete(e.keyCode); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (swallowEnterUp && isEnter(e)) { swallowEnterUp = false; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (ui.panel && ui.panel.isOpen()) return; // the panel handles keys itself
    const fc = focusedChoice();
    if (fc) {
      const curVal = settings.get(fc.id);
      const curIdx = Math.max(0, fc.def.options.findIndex((o) => o[0] === curVal));
      if (!choicePrevFocused.get(fc.id)) {
        choiceCursors.set(fc.id, curIdx);
        choicePrevFocused.set(fc.id, true);
      }
      if (e.keyCode === 38 || e.keyCode === 40) {
        e.preventDefault(); e.stopImmediatePropagation(); swallowedKeys.add(e.keyCode);
        const cur = choiceCursors.get(fc.id) ?? curIdx;
        const nextIdx = e.keyCode === 38 ? Math.max(0, cur - 1) : Math.min(fc.def.options.length - 1, cur + 1);
        choiceCursors.set(fc.id, nextIdx);
        patchChoices();
        return;
      }
      if (isEnter(e)) {
        e.preventDefault(); e.stopImmediatePropagation(); swallowedKeys.add(e.keyCode || 13);
        const idx = choiceCursors.get(fc.id) ?? curIdx;
        const opt = fc.def.options[idx];
        if (opt) settings.set(fc.id, opt[0]);
        patchChoices();
        return;
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(patchChoices);
      return;
    }
    if (e.keyCode === 38 || e.keyCode === 40 || e.keyCode === 39 || isEnter(e)) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(patchChoices);
    }
    if (!isEnter(e)) return;
    const pb = focusedButton();
    if (pb && pb.onPress) {
      votv.log(`ui: player button ${pb.id} pressed`);
      e.preventDefault(); e.stopImmediatePropagation(); swallowEnterUp = true;
      try { pb.onPress(); } catch (err) { votv.error('player button', err); }
      return;
    }
    const b = focusedBoolean();
    if (b && onBooleanPress(b)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const a = focusedAction();
    if (a) runAction(a); // YouTube still closes the popup (POPUP_BACK)
  }, true);
  window.addEventListener('click', (e) => {
    const pill = e.target && e.target.closest && e.target.closest('.votv-choice-pill');
    if (pill && pill.dataset && pill.dataset.votvChoice) {
      const id = pill.dataset.votvChoice, idx = Number(pill.dataset.votvIdx);
      const def = defs.find((d) => d.id === id);
      if (def && def.options && def.options[idx]) {
        choiceCursors.set(id, idx);
        settings.set(id, def.options[idx][0]);
        patchChoices();
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }
    }
    const host = e.target && e.target.closest && e.target.closest('ytlr-setting-boolean-renderer');
    const inst = instanceOf(host);
    if (inst && inst.__votv && onBooleanPress(inst)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const a = actionAt(e.target);
    if (a) runAction(a);
  }, true);

  // ---- player state -------------------------------------------------------------------
  const player = {
    videoId() {
      const m = /[?&]v=([\w-]{11})/.exec(location.hash) || /[?&]v=([\w-]{11})/.exec(location.search);
      return m ? m[1] : '';
    },
    video: () => document.querySelector('video'),
    _subs: [],
    onVideoChange(fn) { player._subs.push(fn); },
  };
  let lastVideo = '';
  function trackVideo() {
    const id = player.videoId();
    if (id === lastVideo) return;
    lastVideo = id;
    player._subs.forEach((fn) => { try { fn(id); } catch (e) { votv.error('onVideoChange', e); } });
  }

  // ---- response hooks (for SponsorBlock / ad filtering) --------------------------------
  const jsonHooks = [];
  const hooks = {
    /** fn(obj) sees every object YouTube parses from JSON (JSON.parse, Response.json) and may
     *  modify it in place. Keep it cheap: it runs for every response. */
    json(fn) { jsonHooks.push(fn); },
  };
  const runJsonHooks = (v) => {
    if (v && typeof v === 'object') {
      for (const fn of jsonHooks) { try { fn(v); } catch (e) { votv.error('json hook', e); } }
    }
    return v;
  };
  const nativeParse = JSON.parse;
  JSON.parse = function () {
    const v = nativeParse.apply(this, arguments);
    return jsonHooks.length ? runJsonHooks(v) : v;
  };
  if (window.Response && Response.prototype.json) {
    const nativeJson = Response.prototype.json;
    Response.prototype.json = function () {
      return nativeJson.apply(this, arguments).then((v) => (jsonHooks.length ? runJsonHooks(v) : v));
    };
  }

  // ---- loop ---------------------------------------------------------------------------
  const ui = {
    PREFIX,
    popup,
    forceUpdate,
    findButtonsBuilder,
    /** Add a button to the player controls; menu() returns {title, subtitle, rows: [{label, subtitle, selected, action}]}. */
    playerButton(b) { if (!buttons.some((x) => x.id === b.id)) buttons.push(b); ui.refresh(); },
    /** Handle an action type from menu rows: rows carry {type, ...} and fn gets that object. */
    onAction(type, fn) { handlers.set(type, fn); },
    refresh() { settingsSignature = ''; playerSignature = ''; },
    choicePopup,
  };

  function tick() {
    try { trackVideo(); } catch (e) { votv.error('ui video', e); }
    try { renderSettings(); patchBooleans(); patchChoices(); } catch (e) { votv.error('ui settings', e); }
    try { renderPlayer(); } catch (e) { votv.error('ui player', e); }
  }
  setInterval(tick, 400);
  if (typeof MutationObserver === 'function') votv.whenBody(() => {
    let scheduled = false;
    const observer = new MutationObserver((records) => {
      if (scheduled) return;
      if (records.some((r) => {
        const t = r.target;
        if (!t || !t.closest) return false;
        const inList = t.closest('.votv-choice-list');
        if (inList && typeof inList.className === 'string' && inList.className.includes('votv-choice-list')) return false;
        if ([...(r.addedNodes || []), ...(r.removedNodes || [])].some((n) => n && typeof n.className === 'string' && n.className.includes('votv-choice-list'))) return false;
        return t.closest('ytlr-setting-single-option-menu-renderer, ytlr-tv-secondary-nav-renderer');
      })) {
        scheduled = true;
        const run = () => {
          scheduled = false;
          try { patchBooleans(); patchChoices(); } catch (e) {}
          if (typeof observer.takeRecords === 'function') observer.takeRecords();
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else setTimeout(run, 16);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });

  votv.ui = ui;
  votv.settings = settings;
  votv.player = player;
  votv.hooks = hooks;
})();
