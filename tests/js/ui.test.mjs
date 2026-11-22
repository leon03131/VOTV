// Tests for plugins/core/ui.js against fake ytlr components shaped like the real ones
// (found with the probe plugin on youtube.com/tv, Oct 2026).
//   node --test tests/js/ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORE = readFileSync(path.join(ROOT, 'plugins/core/core.js'), 'utf8');
const UI = readFileSync(path.join(ROOT, 'plugins/core/ui.js'), 'utf8');
const VOTV = readFileSync(path.join(ROOT, 'plugins/votv/votv.js'), 'utf8');
const PANEL = readFileSync(path.join(ROOT, 'plugins/core/panel.js'), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));

// Component base class: re-render method with the same source shape as YouTube's (Da()).
const COMPONENTS = `
  var renders = 0;
  function Vma(c) { renders++; }
  class Base {
    constructor(props) { this.props = props; this.state = {}; }
    Da(){this.XB={nE:!0,Su:this.state};Vma(this)}
    J(a){this.XB={nE:!1,Su:Object.assign({},this.state,a)};Vma(this)}
  }
  class Actions extends Base {
    constructor(props) {
      super(props);
      const b = (x) => x || [];
      this.ga = () => b(this.props.data.settingActions);
      this.ma = () => new Map(b(this.ga()).map((x) => [x.type, x]));
      this.ra = () => { var c = this.ga(); return c.filter((x) => !/REPORT/.test(x.type)); };
      this.j = () => b(this.props.data.promotedActions);
    }
  }
  class Nav extends Base {}
  class Bool extends Base { get enabled() { return 'youtube-value'; } }
  class Link extends Base {}
`;

function el(tag, inst, classes = []) {
  const attrs = {};
  return {
    tagName: tag.toUpperCase(), __instance: inst, parentElement: null, parentNode: null, closest: () => null,
    children: [], style: {},
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    classList: {
      contains: (c) => classes.includes(c),
      add: (...cs) => cs.forEach((c) => { if (!classes.includes(c)) classes.push(c); }),
    }, querySelector: () => null,
    appendChild(c) { this.children.push(c); c.parentNode = this; },
    replaceChildren() { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; },
  };
}

function page({ hash = '#/' } = {}) {
  const logs = [], store = new Map(), elements = [], listeners = { keydown: [], keyup: [], click: [] }, intervals = [];
  const host = {
    version: () => JSON.stringify({ host: '0.3.0', api: 2, app: '7.30.301-votv.test', dev: false }),
    log: (l, m) => logs.push([l, m]), requestBundle() {},
    storageGet: (k) => (store.has(k) ? store.get(k) : null),
    storageSet: (k, v) => { if (v === null) store.delete(k); else store.set(k, v); },
    request: () => 1, toast() {}, reload() {},
  };
  const makeNode = (tag = 'div') => ({
    tagName: tag.toUpperCase(), id: '', className: '', style: {}, dataset: {}, textContent: '', children: [], parentNode: null,
    appendChild(c) { this.children.push(c); c.parentNode = this; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; },
    replaceChildren() { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; },
  });
  const document = {
    body: { appendChild() {}, children: [] },
    createElement: makeNode,
    addEventListener() {},
    querySelector: (sel) => elements.find((e) => sel.split(',').map((s) => s.trim().toUpperCase()).includes(e.tagName)) || null,
    querySelectorAll: (sel) => (sel === 'ytlr-player-actions-container *' ? elements.filter((e) => e.inActions)
      : elements.filter((e) => sel.split(',').map((s) => s.trim().toUpperCase()).includes(e.tagName))),
  };
  const ctx = {
    VotHost: host, document, navigator: { userAgent: 'Cobalt test' }, location: { hash, search: '', pathname: '/tv' },
    setTimeout: () => 0, clearTimeout() {}, setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    addEventListener: (type, fn) => (listeners[type] || (listeners[type] = [])).push(fn),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(COMPONENTS + '; this.C = { Base, Actions, Nav, Bool, Link, renders: () => renders };', ctx);
  vm.runInContext(CORE, ctx);
  vm.runInContext(UI, ctx);
  vm.runInContext(PANEL, ctx);
  const tick = () => intervals.forEach((fn) => fn());
  const key = (keyCode) => {
    const e = { keyCode, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listeners.keydown.forEach((fn) => fn(e));
    return e;
  };
  return { ctx, C: ctx.C, votv: ctx.__votv, elements, logs, store, tick, key, add: (tag, inst) => { const e = el(tag, inst); elements.push(e); return e; } };
}

const settingsData = () => ({
  title: { runs: [{ text: 'Настройки' }] },
  selectedIndex: 0,
  sections: [{ tvSecondaryNavSectionRenderer: { tabs: [
    { tabRenderer: { title: 'Покупки', content: { settingsPaneRenderer: { itemId: 'MANAGE' } } } },
    { tabRenderer: { title: 'Автовоспроизведение', content: { settingBooleanRenderer: { itemId: 'AUTONAV' } } } },
  ] } }],
});

test('forceUpdate finds the re-render method by its source', () => {
  const p = page();
  const nav = new p.C.Nav({ data: {} });
  const before = p.C.renders();
  assert.equal(p.votv.ui.forceUpdate(nav), true);
  assert.equal(p.C.renders(), before + 1);
});

test('settings: VOTV section is appended to the settings page only', () => {
  const p = page();
  p.votv.settings.define({ id: 'a.bool', type: 'bool', title: 'Флаг', default: true });
  p.votv.settings.define({ id: 'a.choice', type: 'choice', title: 'Выбор', default: 1, options: [[1, 'один'], [2, 'два']] });
  const other = new p.C.Nav({ data: { sections: [{ tvSecondaryNavSectionRenderer: { tabs: [{ tabRenderer: { title: 'Видео', content: { gridRenderer: {} } } }] } }] } });
  p.add('ytlr-tv-secondary-nav-renderer', other);
  p.tick();
  assert.equal(other.props.data.sections[0].tvSecondaryNavSectionRenderer.tabs.length, 1, 'non-settings nav untouched');

  p.elements.length = 0;
  const nav = new p.C.Nav({ data: settingsData() });
  p.add('ytlr-tv-secondary-nav-renderer', nav);
  p.tick();
  const tabs = nav.props.data.sections[0].tvSecondaryNavSectionRenderer.tabs;
  assert.deepEqual(tabs.map((t) => t.tabRenderer.title), ['Покупки', 'Автовоспроизведение', 'VOTV', 'Флаг', 'Выбор']);
  assert.equal(tabs[3].tabRenderer.content.settingBooleanRenderer.itemId, 'VOTV_a.bool');
  assert.equal(tabs[4].tabRenderer.content.settingSingleOptionMenuRenderer.button.buttonRenderer.text.simpleText, 'один');
  const data = nav.props.data, renders = p.C.renders();
  p.tick();
  assert.equal(nav.props.data, data, 'no re-injection while nothing changed');
  assert.equal(p.C.renders(), renders);
});

test('settings: a value change updates rows in place, the tab list is kept', () => {
  const p = page();
  p.votv.settings.define({ id: 'a.choice', type: 'choice', title: 'Выбор', default: 1, options: [[1, 'один'], [2, 'два']] });
  const nav = new p.C.Nav({ data: settingsData() });
  p.add('ytlr-tv-secondary-nav-renderer', nav);
  p.tick();
  const data = nav.props.data;
  const row = data.sections[0].tvSecondaryNavSectionRenderer.tabs[3].tabRenderer.content.settingSingleOptionMenuRenderer;
  const comp = new p.C.Base({ data: row });
  p.add('ytlr-setting-single-option-menu-renderer', comp);
  const renders = p.C.renders();
  p.votv.settings.set('a.choice', 2);
  assert.equal(nav.props.data, data, 'tab list not replaced (selection would reset)');
  assert.equal(row.button.buttonRenderer.text.simpleText, 'два');
  assert.equal(row.button.buttonRenderer.command.openPopupAction, undefined, 'no fullscreen popup command on inline choice tabs');
  const box = p.elements.find((e) => e.tagName === 'YTLR-SETTING-SINGLE-OPTION-MENU-RENDERER').children.find((c) => c.className === 'votv-choice-list');
  assert.ok(box, 'inline choice pills rendered inside right pane');
  assert.deepEqual(box.children.map((c) => [c.children[0].textContent, c.className.includes('vp-selected')]), [['один', false], ['два', true]]);
  assert.ok(p.C.renders() > renders, 'row component re-rendered');
  assert.equal(JSON.parse(p.store.get('settings'))['a.choice'], 2, 'persisted');
});

test('settings: inline choice navigation updates value in place and lets Left/Back return cleanly', () => {
  const p = page();
  p.votv.settings.define({ id: 'a.choice', type: 'choice', title: 'Выбор', default: 1, options: [[1, 'один'], [2, 'два'], [3, 'три']] });
  const nav = new p.C.Nav({ data: settingsData() });
  p.add('ytlr-tv-secondary-nav-renderer', nav);
  p.tick();
  const data = nav.props.data;
  const row = data.sections[0].tvSecondaryNavSectionRenderer.tabs[3].tabRenderer.content.settingSingleOptionMenuRenderer;
  const btnWrap = el('yt-focus-container', null);
  const comp = new p.C.Base({ data: row });
  comp.props.focused = true;
  const hostEl = p.add('ytlr-setting-single-option-menu-renderer', comp);
  hostEl.querySelector = (s) => (s.includes('yt-focus-container') ? btnWrap : null);
  p.tick();

  assert.equal(hostEl.getAttribute('data-votv-choice'), '1', 'choice host marked for CSS layout');
  assert.equal(btnWrap.getAttribute('data-votv-hidden-btn'), '1', 'single dummy popup button visually hidden without collapsing focus');
  const box = hostEl.children.find((c) => c.className === 'votv-choice-list');
  assert.equal(box.children.length, 3);
  assert.ok(box.children[0].className.includes('vp-selected') && box.children[0].className.includes('vp-focus'));

  const down = p.key(40);
  assert.ok(down.defaultPrevented && down.stopped, 'Down stays inside inline pills');
  assert.ok(box.children[1].className.includes('vp-focus'));

  const enter = p.key(13);
  assert.ok(enter.defaultPrevented && enter.stopped, 'Enter confirms option inline');
  assert.equal(p.votv.settings.get('a.choice'), 2);
  assert.ok(box.children[1].className.includes('vp-selected'));
  assert.equal(nav.props.data, data, 'tab list never rebuilt on inline selection');

  const left = p.key(37);
  assert.equal(left.defaultPrevented, false, 'Left passes through to YouTube to return to the exact left tab');
  const back = p.key(27);
  assert.equal(back.defaultPrevented, false, 'Back passes through to YouTube to return to the exact left tab');
});

test('settings: after a popup choice the rebuilt page selects our row again', () => {
  const p = page();
  p.votv.settings.define({ id: 'a.choice', type: 'choice', title: 'Выбор', default: 1, options: [[1, 'один'], [2, 'два']] });
  const link = new p.C.Link({ focused: true, data: { votvAction: { type: 'setting', id: 'a.choice', value: 2 } } });
  p.add('ytlr-compact-link-renderer', link);
  p.key(13); // Enter on the focused popup row
  assert.equal(p.votv.settings.get('a.choice'), 2);
  p.elements.length = 0;
  const nav = new p.C.Nav({ data: settingsData(), selectedIndex: 0 }); // YouTube rebuilds the page from its own data
  p.add('ytlr-tv-secondary-nav-renderer', nav);
  p.tick();
  assert.equal(nav.props.data.selectedIndex, 3);
  assert.equal(nav.props.selectedIndex, 3);
  assert.equal(nav.props.data.sections[0].tvSecondaryNavSectionRenderer.tabs[3].tabRenderer.selected, true);
});

test('settings: our booleans read our value and handle on/off presses', () => {
  const p = page();
  p.votv.settings.define({ id: 'a.bool', type: 'bool', title: 'Флаг', default: true });
  const b = new p.C.Bool({ focused: true, data: { itemId: 'VOTV_a.bool', enabled: true } });
  b.state = { pa: 'off' };
  const native = new p.C.Bool({ focused: false, data: { itemId: 'AUTONAV' } });
  p.add('ytlr-setting-boolean-renderer', b);
  p.add('ytlr-setting-boolean-renderer', native);
  p.tick();
  assert.equal(b.enabled, true);
  assert.equal(native.enabled, 'youtube-value', 'YouTube rows untouched');
  const e = p.key(13);
  assert.equal(p.votv.settings.get('a.bool'), false);
  assert.equal(b.enabled, false);
  assert.ok(e.defaultPrevented && e.stopped, 'YouTube does not also handle the press');
});

test('player: our button goes right after captions, and can be hidden', () => {
  const p = page();
  let visible = true;
  p.votv.ui.playerButton({ id: 'menu', icon: 'TRANSLATE', label: () => 'VOTV', enabled: () => visible, menu: () => ({ title: 'VOTV', rows: [{ label: 'x', action: { type: 'noop' } }] }) });
  const actions = new p.C.Actions({ data: { settingActions: [
    { type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_CAPTIONS' }, { type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS' }, { type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_REPORT_VIDEO' },
  ] } });
  p.add('ytlr-player-actions-container', actions);
  assert.equal(p.votv.ui.findButtonsBuilder(actions), 'ra');
  p.tick();
  const types = actions.ra().map((x) => x.type);
  assert.deepEqual(types, ['TRANSPORT_CONTROLS_BUTTON_TYPE_CAPTIONS', 'TRANSPORT_CONTROLS_BUTTON_TYPE_VOTV_MENU', 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS']);
  const btn = actions.ra()[1].button.buttonRenderer;
  assert.equal(btn.icon.iconType, 'TRANSLATE');
  assert.ok(btn.command.openPopupAction);
  visible = false;
  assert.equal(actions.ra().length, 2);
  actions.props.data = {}; // controls hidden: nothing added
  assert.deepEqual(plain(actions.ra()), []);
});

test('hooks.json sees parsed JSON; player.videoId reads the route', () => {
  const p = page({ hash: '#/watch?v=kfcHg_Wh5FM&t=1' });
  const seen = [];
  p.votv.hooks.json((o) => { seen.push(o); o.touched = true; });
  const v = vm.runInContext('JSON.parse(\'{"playerResponse":{"a":1}}\')', p.ctx);
  assert.equal(v.touched, true);
  assert.equal(seen.length, 1);
  assert.equal(p.votv.player.videoId(), 'kfcHg_Wh5FM');
});

test('votv plugin: defines its settings and the player button', () => {
  const p = page();
  vm.runInContext(VOTV, p.ctx);
  const ids = p.votv.settings.list().map((d) => d.id);
  assert.deepEqual(plain(ids), ['votv.button', 'votv.startToast', 'votv.about', 'votv.update']);
  assert.equal(p.votv.settings.get('votv.button'), true);
  assert.ok(p.logs.some(([, m]) => m === 'plugin votv loaded'));
});

test('player button: Enter on it (focus shown by .zylon-focus) runs onPress, YouTube does not get the key', () => {
  const p = page();
  let pressed = 0;
  p.votv.ui.playerButton({ id: 'menu', label: 'VOTV', onPress: () => { pressed++; } });
  // descendants of the actions container: plain elements without an instance come first
  const plainDiv = el('div', undefined); plainDiv.inActions = true; p.elements.push(plainDiv);
  const other = el('ytlr-button-renderer', new p.C.Base({ data: { icon: {} } })); other.inActions = true; p.elements.push(other);
  const ours = el('ytlr-button-renderer', new p.C.Base({ data: { votvButton: 'menu', text: {} } }), ['zylon-focus']);
  ours.inActions = true; p.elements.push(ours);
  const e = p.key(13);
  assert.equal(pressed, 1);
  assert.ok(e.defaultPrevented && e.stopped);
  ours.classList.contains = () => false; // focus elsewhere
  p.key(13);
  assert.equal(pressed, 1);
});
