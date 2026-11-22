// Tests for the feature plugins (adblock, sponsorblock) and the panel API, in a fake page.
//   node --test tests/js/plugins.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const CORE = ['plugins/core/core.js', 'plugins/core/ui.js', 'plugins/core/panel.js'].map(read).join('\n');
const plain = (o) => JSON.parse(JSON.stringify(o));

function page({ hash = '#/watch?v=kfcHg_Wh5FM', respond } = {}) {
  const logs = [], store = new Map(), intervals = [], toasts = [], requests = [];
  let nextId = 0;
  const host = {
    version: () => JSON.stringify({ host: '0.3.0', api: 2, app: '7.30.301-votv.test', dev: false }),
    log: (l, m) => logs.push([l, m]), requestBundle() {},
    storageGet: (k) => (store.has(k) ? store.get(k) : null),
    storageSet: (k, v) => { if (v === null) store.delete(k); else store.set(k, v); },
    request: (json) => {
      const id = ++nextId, req = JSON.parse(json);
      requests.push(req);
      Promise.resolve().then(() => ctx.__votvHost.resolve(id, JSON.stringify(respond ? respond(req) : { status: 404 })));
      return id;
    },
    toast() {}, reload() {},
  };
  const listeners = new Map();
  const video = {
    currentTime: 0, duration: 600, paused: false, muted: false, seeking: false, readyState: 4, playbackRate: 1,
    addEventListener(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
    emit(ev) { for (const fn of (listeners.get(ev) || [])) fn(); },
  };
  const body = {
    children: [],
    appendChild(e) { this.children.push(e); e.parentNode = this; },
  };
  const document = {
    body, head: null,
    createElement: () => ({ id: '', className: '', children: [], style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild(e) { this.children.push(e); e.parentNode = this; }, remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; }, dataset: {} }),
    createTextNode: (t) => ({ t }),
    addEventListener() {},
    querySelector: (sel) => (sel === 'video' ? video : null),
    querySelectorAll: () => [],
  };
  const winListeners = new Map();
  const ctx = {
    VotHost: host, document, navigator: { userAgent: 'Cobalt test' }, location: { hash, search: '', pathname: '/tv' },
    setTimeout: (fn) => 0, clearTimeout() {}, setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    addEventListener(ev, fn) { if (!winListeners.has(ev)) winListeners.set(ev, []); winListeners.get(ev).push(fn); },
    emitKey(keyCode) {
      const ev = { keyCode, preventDefault() {}, stopImmediatePropagation() {} };
      for (const fn of (winListeners.get('keydown') || [])) fn(ev);
    },
    crypto: webcrypto, TextEncoder, requestAnimationFrame: (fn) => fn(),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx);
  ctx.__votv.toast = (t) => toasts.push(t);
  const load = (p) => vm.runInContext(read(p), ctx);
  return { ctx, votv: ctx.__votv, video, logs, store, toasts, requests, load, tick: () => intervals.forEach((f) => f()) };
}

// ---- adblock --------------------------------------------------------------------------
test('adblock: strips ad fields from player responses parsed by the page', () => {
  const p = page();
  p.load('plugins/adblock/adblock.js');
  const body = JSON.stringify({ responseContext: {}, playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'x' },
    adPlacements: [{ a: 1 }, { a: 2 }], playerAds: [{ b: 1 }], adSlots: [], adBreakHeartbeatParams: 'xyz' });
  const r = vm.runInContext(`JSON.parse(${JSON.stringify(body)})`, p.ctx);
  for (const k of ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']) assert.equal(k in r, false, k);
  assert.equal(r.playabilityStatus.status, 'OK');
  assert.equal(p.votv.plugins.adblock.stats.player, 3, 'heartbeat params are not counted as ads');
});

test('adblock: removes ad items from feeds, keeps content', () => {
  const p = page();
  p.load('plugins/adblock/adblock.js');
  const feed = { responseContext: {}, contents: { sectionListRenderer: { contents: [
    { shelfRenderer: { content: { horizontalListRenderer: { items: [
      { tileRenderer: { id: 1 } }, { adSlotRenderer: { id: 'ad' } }, { tileRenderer: { id: 2 } },
    ] } } } },
    { richItemRenderer: { content: { promotedVideoRenderer: {} } } },
    { richItemRenderer: { content: { videoRenderer: { id: 3 } } } },
  ] } } };
  const r = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(feed))})`, p.ctx);
  const rows = r.contents.sectionListRenderer.contents;
  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows[0].shelfRenderer.content.horizontalListRenderer.items.map((i) => i.tileRenderer.id)), [1, 2]);
  assert.equal(rows[1].richItemRenderer.content.videoRenderer.id, 3);
  assert.equal(p.votv.plugins.adblock.stats.items, 2);
});

test('adblock: off means untouched', () => {
  const p = page();
  p.load('plugins/adblock/adblock.js');
  p.votv.settings.set('ads.enabled', false);
  const r = vm.runInContext(`JSON.parse('{"playabilityStatus":{},"adPlacements":[1]}')`, p.ctx);
  assert.deepEqual(plain(r.adPlacements), [1]);
});

// ---- sponsorblock ---------------------------------------------------------------------
const VID = 'kfcHg_Wh5FM';
const PREFIX = createHash('sha256').update(VID).digest('hex').slice(0, 4);
const sbResponse = (segments) => (req) => {
  if (!req.url.includes(`/skipSegments/${PREFIX}?`)) return { status: 500, error: 'unexpected url ' + req.url };
  return { status: 200, body: JSON.stringify([{ videoID: 'other', segments: [{ category: 'sponsor', actionType: 'skip', segment: [1, 2], UUID: 'x' }] }, { videoID: VID, segments }]) };
};
const seg = (category, start, end, actionType = 'skip', UUID = `${category}-${start}`) => ({ category, actionType, segment: [start, end], UUID });
const flush = () => new Promise((r) => setTimeout(r, 0));

test('sponsorblock: looks segments up by sha256 prefix and keeps only this video', async () => {
  const p = page({ respond: sbResponse([seg('selfpromo', 384.9, 410.4), seg('sponsor', 100, 130)]) });
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  assert.equal(await sb.sha256Prefix(VID), PREFIX);
  const segs = await sb.fetchSegments(VID);
  assert.deepEqual(plain(segs.map((s) => [s.category, s.start])), [['sponsor', 100], ['selfpromo', 384.9]]);
  assert.ok(!p.requests[0].url.includes(VID), 'the video id itself is not sent');
});

test('sponsorblock: 404 means no segments', async () => {
  const p = page({ respond: () => ({ status: 404, body: 'Not Found' }) });
  p.load('plugins/sponsorblock/sponsorblock.js');
  assert.deepEqual(plain(await p.votv.plugins.sponsorblock.fetchSegments(VID)), []);
});

test('sponsorblock: auto skips, manual only offers, off ignores, mute mutes', async () => {
  const p = page({ respond: sbResponse([
    seg('sponsor', 100, 130), seg('intro', 200, 210), seg('filler', 300, 320), seg('selfpromo', 400, 420, 'mute'),
  ]) });
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID);
  await flush();
  assert.equal(sb.segments().length, 4);

  p.video.currentTime = 101; sb.tick();
  assert.equal(p.video.currentTime, 130, 'sponsor (auto) skipped to its end');
  assert.match(p.toasts.at(-1), /Спонсорская реклама/);

  p.video.currentTime = 201; sb.tick();
  assert.equal(p.video.currentTime, 201, 'intro (manual) is not skipped');
  assert.match(p.toasts.at(-1), /Заставка/);

  p.video.currentTime = 301; sb.tick();
  assert.equal(p.video.currentTime, 301, 'filler (off) ignored');

  p.video.currentTime = 405; sb.tick();
  assert.equal(p.video.muted, true, 'mute segment mutes');
  p.video.currentTime = 425; sb.tick();
  assert.equal(p.video.muted, false, 'and restores sound after it');

  assert.equal(sb.stats.count, 1);
  assert.equal(Math.round(sb.stats.seconds), 29);
});

test('sponsorblock: does not skip while paused, skips past the end at most to duration', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', 590, 640)]) });
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID);
  await flush();
  p.video.paused = true; p.video.currentTime = 591; sb.tick();
  assert.equal(p.video.currentTime, 591);
  p.video.paused = false; sb.tick();
  assert.equal(p.video.currentTime, 599.75);
});

// ---- panel ----------------------------------------------------------------------------
test('panel: sponsorblock section rows follow the current state', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', 100, 130), seg('poi_highlight', 50, 50, 'poi')]) });
  const sections = [];
  p.votv.ui.panel.section = (s) => sections.push(s); // capture what plugins register
  p.load('plugins/sponsorblock/sponsorblock.js');
  p.load('plugins/adblock/adblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID);
  await flush();
  const rows = () => sections.find((s) => s.id === 'sb').rows();
  const labels = () => rows().map((r) => r.label);

  assert.deepEqual(plain(labels()), ['Пропускать сегменты', 'Отметки на шкале', 'К главному моменту', 'Сегменты этого видео', 'Категории']);
  p.votv.settings.set('sb.cat.sponsor', 'manual');
  p.video.currentTime = 110; // inside the sponsor segment: a skip button appears
  const skipRow = rows().find((r) => r.id === 'skipnow');
  assert.equal(skipRow.label, 'Пропустить: Спонсорская реклама');
  skipRow.onPress();
  assert.equal(p.video.currentTime, 130);
  assert.ok(rows().some((r) => r.id === 'undo'), 'undo button appears after skipping');
  rows().find((r) => r.id === 'undo').onPress();
  assert.equal(p.video.currentTime, 110, 'undo restores previous playback time');
  rows().find((r) => r.id === 'poi').onPress();
  assert.equal(p.video.currentTime, 50);
  p.votv.settings.set('sb.enabled', false);
  assert.deepEqual(plain(labels()), ['Пропускать сегменты', 'Отметки на шкале']);
  assert.ok(sections.some((s) => s.id === 'ads'));
});

test('timeline: clamps intervals, uses green/yellow, includes poi_highlight, respects disabled categories and invalid duration', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', -10, 30), seg('selfpromo', 580, 650), seg('intro', 40, 50), seg('poi_highlight', 50, 50, 'poi'), seg('sponsor', 20, 10)]) });
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID);
  let marks = plain(sb.timelineSegments(600));
  assert.equal(marks.length, 4);
  assert.deepEqual(marks[0], { start: 0, end: 30, color: '#00d400', category: 'sponsor', left: 0, width: 5 });
  const poiMark = marks.find((m) => m.category === 'poi_highlight');
  assert.equal(poiMark.color, '#ff1684');
  assert.equal(poiMark.poi, true);
  assert.equal(marks.at(-1).color, '#f5b800');
  assert.equal(marks.at(-1).end, 600);
  p.votv.settings.set('sb.cat.sponsor', 'off');
  assert.equal(sb.timelineSegments(600).length, 3);
  p.votv.settings.set('sb.cat.poi_highlight', 'off');
  assert.equal(sb.timelineSegments(600).length, 2);
  assert.equal(sb.timelineSegments(Infinity).length, 0);
  p.votv.settings.set('sb.timeline', false);
  assert.equal(sb.timelineSegments(600).length, 0);
});

test('sponsorblock: full-video segment, manual prompt lifecycle, and undo does not immediately re-skip', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', 100, 130), seg('intro', 200, 220), seg('selfpromo', 0, 0, 'full')]) });
  const sections = [];
  p.votv.ui.panel.section = (s) => sections.push(s);
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID);
  await flush();

  const fullRow = sections.find((s) => s.id === 'sb').rows().find((r) => r.id === 'full');
  assert.equal(fullRow.value, 'Самореклама');
  assert.ok(p.toasts.some((t) => t.includes('всё видео')));

  p.video.currentTime = 105; sb.tick();
  assert.equal(p.video.currentTime, 130);
  assert.equal(sb.prompt().kind, 'undo');
  assert.equal(sb.undoSkip(), true);
  assert.equal(p.video.currentTime, 105);
  assert.equal(sb.prompt().kind, 'manual');
  sb.tick();
  assert.equal(p.video.currentTime, 105, 'undo keeps segment marked done so it does not re-skip');
  p.ctx.emitKey(27); // Back/Esc dismisses manual prompt cleanly
  assert.equal(sb.prompt(), null);
  sb.tick();
  assert.equal(sb.prompt(), null, 'dismissed prompt stays hidden while still inside the segment');

  p.video.currentTime = 205; sb.tick();
  assert.equal(sb.prompt().kind, 'manual');
  p.video.currentTime = 230; sb.tick();
  assert.equal(sb.prompt(), null, 'manual prompt dismisses after leaving segment');
});

test('sponsorblock: rewind into skipped segment does not re-skip and shows manual prompt', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', 100, 130)]) });
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID); await flush();
  p.video.currentTime = 102; sb.tick();
  assert.equal(p.video.currentTime, 130);
  p.video.currentTime = 115; sb.tick(); // rewind past 5s or back into ad
  assert.equal(p.video.currentTime, 115, 'rewinding into already-skipped ad does not auto-skip again');
  p.video.currentTime = 140; sb.tick(); // expire/leave and re-enter via rewind later
  assert.equal(sb.prompt(), null);
  p.video.currentTime = 112; sb.tick();
  assert.equal(p.video.currentTime, 112);
  assert.equal(sb.prompt().kind, 'manual');
});

test('sponsorblock: manual seek into unskipped segment skips auto-skip, seeking before still auto-skips', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', 100, 130), seg('selfpromo', 200, 230)]) });
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID); await flush();
  p.video.currentTime = 10; sb.tick();
  p.video.emit('seeking');
  p.video.currentTime = 115;
  p.video.emit('seeked');
  sb.tick();
  assert.equal(p.video.currentTime, 115, 'seeking directly into segment does not yank viewer forward');
  assert.equal(sb.prompt().kind, 'manual');

  p.video.emit('seeking');
  p.video.currentTime = 190;
  p.video.emit('seeked');
  sb.tick();
  assert.equal(sb.prompt(), null);
  p.video.currentTime = 201; sb.tick();
  assert.equal(p.video.currentTime, 230, 'seeking before an unskipped segment still auto-skips when reached');
});

test('sponsorblock: chains adjacent/overlapping auto-skip segments and undo protects all chained segments', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', 100, 120), seg('selfpromo', 120.3, 140)]) });
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID); await flush();
  p.video.currentTime = 102; sb.tick();
  assert.equal(p.video.currentTime, 140, 'chained adjacent segments skipped in one jump');
  assert.equal(sb.stats.count, 1);
  assert.equal(sb.undoSkip(), true);
  assert.equal(p.video.currentTime, 102);
  sb.tick();
  assert.equal(p.video.currentTime, 102);
  p.video.currentTime = 125; sb.tick();
  assert.equal(p.video.currentTime, 125, 'second chained segment also stays marked done after undo');
});

test('timeline: body overlay aligns chapters, survives Incremental DOM rebuilds, hides on invisible, and cleans up on disable', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', 60, 120), seg('selfpromo', 180, 240)]) });
  function node(key = '', width = 300, height = 8, left = 0) {
    return { id: '', children: [], style: {}, className: '', getAttribute: () => key, setAttribute() {}, getBoundingClientRect: () => ({ width, height, left, top: 700 }),
      appendChild(e) { this.children.push(e); e.parentNode = this; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((e) => e !== this); this.parentNode = null; },
      replaceChildren() { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; },
    };
  }
  const mm = node('mm', 600, 8, 0);
  const bar = node('progress-bar', 600, 8, 0), chapter = node('chapter-0', 300, 8, 0), second = node('chapter-1', 300, 8, 300), fill = node('current-chapter', 150, 8, 0);
  chapter.children.push(fill); bar.children.push(chapter, second); mm.children.push(bar); bar.parentNode = mm;
  const slider = node('slider', 600, 8, 0), track = node('', 600, 8, 0);
  track.style.transform = 'translateX(0rem) scaleX(0.5)'; slider.children.push(track);
  p.ctx.document.createElement = () => node();
  p.ctx.getComputedStyle = (e) => ({ position: e.style.position || 'static', display: e.style.display || 'block', visibility: e.style.visibility || 'visible', opacity: e.style.opacity || '1' });
  let onMutation;
  p.ctx.MutationObserver = class { constructor(fn) { onMutation = fn; } observe() {} };
  p.ctx.document.querySelectorAll = (selector) => selector.includes('multi-markers') ? [bar] : selector.includes('[idomkey="slider"]') ? [slider] : [];
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID); sb.paintTimeline();
  assert.equal(chapter.children.length, 1, 'chapter DOM children untouched so Incremental DOM cannot strip markers');
  assert.equal(mm.children.length, 1, 'mm children untouched so Incremental DOM cannot wipe overlay or break edu');
  assert.equal(slider.children.length, 1, 'slider DOM children untouched');
  const sbHost = p.ctx.document.body.children.find((e) => e.id === 'votv-sb-host');
  assert.ok(sbHost, 'overlay host mounted directly on document.body');
  assert.equal(sbHost.children.length, 2, 'renders both chapter bar and slider overlays');
  const chOverlay = sbHost.children[0];
  assert.match(chOverlay.style.cssText, /position:fixed;.*left:0px;top:700px;width:600px;height:8px/);
  assert.equal(chOverlay.children.length, 1);
  const chBox = chOverlay.children[0];
  assert.equal(chBox.children.length, 2);
  assert.match(chBox.children[0].style.cssText, /top:0px;height:100%;left:20%;width:20%;background-color:#00d400/);
  assert.match(chBox.children[1].style.cssText, /left:60%;width:20%;background-color:#f5b800/);
  sb.paintTimeline();
  assert.equal(sbHost.children[0], chOverlay, 'identical signature skips DOM recreation');
  // Simulate YouTube Incremental DOM rebuilding the active scrubbed chapter and inserting current-chapter
  chapter.children = [node('current-chapter', 220, 12, 0)];
  chapter.closest = (sel) => (sel.includes('multi-markers') ? mm : null);
  onMutation([{ target: chapter }]);
  assert.ok(sbHost.parentNode === p.ctx.document.body, 'marker overlay remains intact on active chapter rebuild');
  mm.__instance = { props: { isHidden: true } };
  slider.style.display = 'none';
  sb.paintTimeline();
  assert.equal(sbHost.parentNode, null, 'overlay host hides cleanly when player bars become hidden');
  delete mm.__instance;
  slider.style.display = 'block';
  sb.paintTimeline();
  assert.ok(p.ctx.document.body.children.some((e) => e.id === 'votv-sb-host'));
  p.votv.settings.set('sb.timeline', false); sb.paintTimeline();
  assert.equal(p.ctx.document.body.children.some((e) => e.id === 'votv-sb-host'), false);
  assert.equal(mm.style.position || '', '');
  assert.equal(track.style.transform, 'translateX(0rem) scaleX(0.5)');
});

test('timeline: uses exact chapter timestamps from __instance and native cue-ranges layer on slider', async () => {
  const p = page({ respond: sbResponse([seg('sponsor', 150, 200)]) });
  function node(key = '', width = 300, height = 12, left = 0) {
    return { id: '', children: [], style: {}, className: '', getAttribute: () => key, setAttribute() {}, getBoundingClientRect: () => ({ width, height, left, top: 700 }),
      appendChild(e) { this.children.push(e); e.parentNode = this; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((e) => e !== this); this.parentNode = null; },
      replaceChildren() { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; },
    };
  }
  const mm = node('player-bar-renderer', 600, 12, 0);
  // chapter-0 is clamped wide in pixels (0-100s -> 300px), chapter-1 is 100-300s -> 300px.
  // Segment [150, 200] must map to 25%-50% inside chapter-1 using real timestamps!
  // Trailing 0-width chapter in props.data.chapters (not rendered in DOM) must not break exact mapping!
  mm.__instance = { props: { data: { chapters: [{ start: 0, end: 100 }, { start: 100, end: 300 }, { start: 300, end: 310 }] } } };
  const bar = node('progress-bar', 600, 12, 0);
  mm.children.push(bar); bar.parentNode = mm;
  const ch0 = node('chapter-0', 300, 12, 0), ch1 = node('chapter-1', 300, 12, 306);
  bar.children.push(ch0, ch1);

  const slider = node('slider', 600, 9, 0);
  const cueRanges = node('cue-ranges', 600, 9, 0);
  slider.children.push(cueRanges);

  p.ctx.document.createElement = () => node();
  p.ctx.getComputedStyle = (e) => ({ position: e.style.position || 'static', display: 'block', visibility: 'visible', opacity: '1' });
  p.ctx.document.querySelectorAll = (selector) => selector.includes('multi-markers') ? [bar] : selector.includes('[idomkey="slider"]') ? [slider] : [];
  p.video.duration = 600;
  p.load('plugins/sponsorblock/sponsorblock.js');
  const sb = p.votv.plugins.sponsorblock;
  await sb.load(VID); sb.paintTimeline();

  assert.equal(ch0.children.length, 0);
  assert.equal(ch1.children.length, 0);
  assert.equal(cueRanges.children.length, 0);
  const sbHost = p.ctx.document.body.children.find((e) => e.id === 'votv-sb-host');
  assert.ok(sbHost);
  assert.equal(sbHost.children.length, 2);
  const chOverlay = sbHost.children[0];
  assert.equal(chOverlay.children.length, 1);
  assert.match(chOverlay.children[0].style.cssText, /left:306px;top:0px;width:300px;height:12px/);
  assert.match(chOverlay.children[0].children[0].style.cssText, /top:0px;height:100%;left:25%;width:25%;background-color:#00d400/);
  const slOverlay = sbHost.children[1];
  assert.match(slOverlay.children[0].children[0].style.cssText, /top:0px;height:100%;left:25%;width:8.33/);
});
