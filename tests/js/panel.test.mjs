import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.className = ''; this.offsetTop = 0; this.offsetHeight = 70; this.clientHeight = 800; this.scrollHeight = 800; this._text = ''; }
  classList = {
    contains: (s) => this.className.split(' ').includes(s),
    toggle: (s, on) => { const parts = new Set(this.className.split(' ').filter(Boolean)); if (on) parts.add(s); else parts.delete(s); this.className = [...parts].join(' '); },
    add: (s) => this.classList.toggle(s, true), remove: (s) => this.classList.toggle(s, false),
  };
  set textContent(s) { this._text = s; this.children = []; }
  get textContent() { return this._text; }
  appendChild(e) { this.children.push(e); e.offsetParent = this; return e; }
  setAttribute() {}
  querySelector(sel) { for (const e of this.children) { if (e.classList.contains(sel.slice(1))) return e; const found = e.querySelector(sel); if (found) return found; } return null; }
}

test('panel: unchanged refresh preserves DOM, focus and dropdown; changed values render once', () => {
  const body = new Element('body'), handlers = {}, intervals = [];
  const document = { body, head: body, createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: (s) => Object.assign(new Element('#text'), { _text: s }), querySelector: () => null };
  let clock = 1000;
  const ctx = { document, __votv: { ui: {}, error: (...a) => { throw new Error(a.join(' ')); } }, Date: { now: () => (clock += 100) }, requestAnimationFrame: (fn) => fn(), setInterval: (fn) => intervals.push(fn), addEventListener: (key, fn) => { handlers[key] = fn; } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../../plugins/core/panel.js', import.meta.url), 'utf8'), ctx);
  let value = 'a'; const panel = ctx.__votv.ui.panel;
  panel.section({ id: 'test', rows: () => [{ id: 'select', kind: 'select', label: 'Language', value: () => value, options: [['a', 'A'], ['b', 'B']], onChange: (v) => { value = v; } }] });
  const key = (keyCode) => handlers.keydown({ type: 'keydown', keyCode, preventDefault() {}, stopImmediatePropagation() {} });
  panel.open();
  const list = body.querySelector('.vp-list'), initial = list.children[0];
  for (let i = 0; i < 10; i++) intervals.forEach((fn) => fn());
  assert.equal(list.children[0], initial, 'idle refresh must not rebuild the DOM');
  key(13); const dropdown = list.children[0];
  assert.ok(body.querySelector('.vp-opts'));
  for (let i = 0; i < 10; i++) panel.refresh();
  assert.equal(list.children[0], dropdown);
  assert.ok(body.querySelector('.vp-focus').dataset.vpId.endsWith('#0'));
  key(40); key(13); assert.equal(value, 'b');
  assert.equal(body.querySelector('.vp-opts'), null);
  assert.equal(body.querySelector('.vp-focus').dataset.vpId, 'test.select');
  const changed = list.children[0]; panel.refresh(); assert.equal(list.children[0], changed);
  panel.close(); panel.open(); assert.ok(body.querySelector('.vp-focus'));
  panel.section({ id: 'nested', rows: () => [{ kind: 'group', id: 'group', label: 'Categories', rows: [{ kind: 'select', id: 'choice', label: 'Sponsor', value: () => value, options: [['a', 'A'], ['b', 'B']], onChange: (v) => { value = v; } }] }] });
  key(40); key(13); key(40); key(13);
  assert.ok(body.querySelector('.vp-focus').dataset.vpId.includes('nested.group/'), 'opening nested select keeps enclosing group open');
  assert.ok(body.querySelector('.vp-focus').dataset.vpId.endsWith('#1'));
  key(38); key(13); assert.equal(value, 'a');
  assert.equal(body.querySelector('.vp-focus').dataset.vpId, 'nested.group/nested.choice');
});

test('panel: focusing first and last focusable rows clamps scroll to reveal trailing info rows', () => {
  const body = new Element('body'), handlers = {};
  const document = { body, head: body, createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: (s) => Object.assign(new Element('#text'), { _text: s }), querySelector: () => null };
  let clock = 1000;
  const ctx = { document, __votv: { ui: {}, error: (...a) => { throw new Error(a.join(' ')); } }, Date: { now: () => (clock += 100) }, requestAnimationFrame: (fn) => fn(), setInterval: () => 0, addEventListener: (key, fn) => { handlers[key] = fn; } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../../plugins/core/panel.js', import.meta.url), 'utf8'), ctx);
  const panel = ctx.__votv.ui.panel;
  panel.section({ id: 'a', order: 10, rows: () => [{ id: 'b1', kind: 'button', label: 'First', onPress() {} }, { id: 'b2', kind: 'button', label: 'Last', onPress() {} }] });
  panel.section({ id: 'tail', order: 20, rows: () => [{ id: 'info', kind: 'info', label: 'Все настройки VOTV' }] });
  const key = (keyCode) => handlers.keydown({ type: 'keydown', keyCode, preventDefault() {}, stopImmediatePropagation() {} });
  panel.open();
  const list = body.querySelector('.vp-list'), scroll = list.children[0];
  list.clientHeight = 800;
  scroll.scrollHeight = 1100;
  key(40);
  assert.equal(scroll.style.transform, 'translateY(-300px)', 'last focusable reveals trailing non-focusable rows');
  key(38);
  assert.equal(scroll.style.transform, 'translateY(0px)', 'first focusable resets scroll to top');
});
