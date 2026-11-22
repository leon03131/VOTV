// Tests for the vot plugin: the fetch adapter that routes @vot.js/core through the host, and
// the plugin flow (translate -> native audio -> sync -> lively voice -> audio upload -> subtitles)
// with a fake VOTClient and a fake host.
//   node --test tests/js/vot.test.mjs   (needs `npm install`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.__votv = { define() {} };
const { makeHostFetch, createVotPlugin, proxifyAudioUrl, parseSubtitlesPayload } = await import('../../plugins/vot/src/index.js');

function translationPage(t, responses, opts = {}) {
  const values = new Map(), changes = new Map(), calls = [], waits = [], jsonHooks = [], uploadCalls = [], failCalls = [];
  const video = { currentTime: 10, duration: 600, volume: 0.7, paused: false, readyState: 4, playbackRate: 1 };
  let audio = { state: 'ready', position: 10, duration: 600 }, instances = 0;
  const host = Object.fromEntries(['Load', 'Release', 'Play', 'Pause', 'Seek', 'Rate', 'Volume'].map((n) => ['audio' + n, (...args) => calls.push([n, ...args])]));
  host.audioState = () => JSON.stringify(audio);
  const created = [];
  const body = { appendChild(e) { created.push(e); } };
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldInterval = globalThis.setInterval, oldTimeout = globalThis.setTimeout;
  globalThis.window = { VotHost: host };
  globalThis.document = {
    hidden: false, body,
    createElement: (tag) => ({ tag, id: '', style: { cssText: '' }, textContent: '' }),
  };
  globalThis.setInterval = () => 0;
  globalThis.setTimeout = (fn, ms) => { waits.push(ms); if (ms !== 2500) queueMicrotask(fn); return 0; };
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.setInterval = oldInterval; globalThis.setTimeout = oldTimeout; });
  const translateArgs = [];
  class Client {
    constructor() {
      instances++;
      this.provider = {
        requestVtransAudio: async (...a) => { uploadCalls.push(a); return { status: 1 }; },
        requestVtransFailAudio: async (...a) => { failCalls.push(a); return { status: 1 }; },
      };
    }
    async translateVideo(p) {
      translateArgs.push(p);
      const r = responses.shift();
      return typeof r === 'function' ? r(p) : r;
    }
    async getSubtitles() {
      return opts.subtitlesResponse || { waiting: false, subtitles: [] };
    }
  }
  const votv = {
    settings: {
      define: (d) => values.set(d.id, d.default),
      get: (k) => values.get(k),
      set: (k, v) => { values.set(k, v); if (changes.has(k)) changes.get(k)(v); },
      onChange: (k, fn) => changes.set(k, fn),
    },
    player: { video: () => video, videoId: () => '8wv3JJNc-h4', onVideoChange() {} },
    ui: { panel: { refresh() {}, section() {} } },
    hooks: { json: (fn) => jsonHooks.push(fn) },
    request: opts.request || (async () => ({ status: 404, bodyBase64: '' })),
    info: {}, log() {}, warn() {}, toast() {},
  };
  const plugin = createVotPlugin(votv, Client);
  return {
    plugin, calls, waits, video, votv, translateArgs, uploadCalls, failCalls, created,
    emitJson: (o) => jsonHooks.forEach((fn) => fn(o)),
    setAudio: (a) => { audio = { ...audio, ...a }; },
    instances: () => instances,
  };
}

test('translation: polling reuses the client session and checks readiness within ten seconds', async (t) => {
  const p = translationPage(t, [{ translated: false, remainingTime: 80 }, { translated: false, remainingTime: 2 }, { translated: true, url: 'https://audio', remainingTime: -1 }]);
  await p.plugin.start();
  assert.equal(p.instances(), 1);
  assert.deepEqual(p.waits, [10000, 3000]);
  assert.equal(p.plugin.state().phase, 'ready');
  assert.equal(p.calls.filter(([n]) => n === 'Load').length, 1);
});

test('translation: cancelling an in-flight request never starts stale audio', async (t) => {
  let resolve;
  const p = translationPage(t, [() => new Promise((r) => { resolve = r; })]);
  const run = p.plugin.start();
  p.plugin.stop();
  resolve({ translated: true, url: 'https://audio' });
  await run;
  assert.equal(p.plugin.state().phase, 'off');
  assert.equal(p.calls.some(([n]) => n === 'Load'), false);
});

test('translation: playback errors restore original volume and release audio', async (t) => {
  const p = translationPage(t, [{ translated: true, url: 'https://audio' }]);
  await p.plugin.start(); p.plugin.sync();
  assert.equal(p.video.volume, 0.2);
  p.setAudio({ state: 'error', error: 'network' }); p.plugin.sync();
  assert.equal(p.video.volume, 0.7);
  assert.equal(p.plugin.state().phase, 'error');
  assert.equal(p.calls.at(-1)[0], 'Release');
});

test('translation: seeking back after audio completion restarts playback', async (t) => {
  const p = translationPage(t, [{ translated: true, url: 'https://audio' }]);
  await p.plugin.start();
  p.setAudio({ state: 'ended', position: 600 }); p.plugin.sync();
  assert.ok(p.calls.some(([n]) => n === 'Seek'));
  assert.ok(p.calls.some(([n]) => n === 'Play'));
});

test('translation: completion restores original volume, background pauses native audio', async (t) => {
  const p = translationPage(t, [{ translated: true, url: 'https://audio' }]);
  await p.plugin.start(); p.plugin.sync();
  p.setAudio({ state: 'playing' }); document.hidden = true; p.plugin.sync();
  assert.equal(p.calls.at(-1)[0], 'Pause');
  document.hidden = false; p.video.currentTime = 600;
  p.setAudio({ state: 'ended', position: 600 }); p.plugin.sync();
  assert.equal(p.video.volume, 0.7);
});

test('translation: partial audio keeps playing while the backend is still processing', async (t) => {
  let resolve;
  const p = translationPage(t, [{ translated: true, url: 'https://part', remainingTime: 80 }, { translated: false, remainingTime: 80 }, () => new Promise((r) => { resolve = r; })]);
  const run = p.plugin.start();
  for (let i = 0; i < 12 && !resolve; i++) await Promise.resolve();
  assert.equal(p.plugin.state().phase, 'ready');
  p.plugin.stop(); resolve({ translated: true, url: 'https://full' }); await run;
});

test('translation: partial status=5 ignores rotating tokens, reports partial duration and ETA, and loads once full arrives', async (t) => {
  let stepResolve;
  const p = translationPage(t, [
    { translated: true, status: 5, url: 'https://vtrans.s3-private.mds.yandex.net/tts/prod/part.mp3?token=t1', remainingTime: 21 },
    { translated: true, status: 5, url: 'https://vtrans.s3-private.mds.yandex.net/tts/prod/part.mp3?token=t2', remainingTime: 5 },
    () => new Promise((r) => { stepResolve = r; }),
  ]);
  p.video.currentTime = 770;
  p.video.duration = 1900;
  p.setAudio({ state: 'ended', position: 600, duration: 600 });
  const run = p.plugin.start();
  for (let i = 0; i < 16 && !stepResolve; i++) await Promise.resolve();
  assert.equal(p.calls.filter(([n]) => n === 'Load').length, 1, 'same pathname with rotating query token must not reload partial audio');
  assert.deepEqual(p.waits, [10000, 10000], 'partial polling always waits 10s');
  p.plugin.sync();
  assert.equal(p.video.volume, 0.7, 'original volume restored when video is past 600s partial audio');
  assert.match(p.plugin.state().message, /Переведена часть видео \(до 10:00\) · ждём остальное \(~5 с\)/);

  stepResolve({ translated: true, status: 1, url: 'https://vtrans.s3-private.mds.yandex.net/tts/prod/part.mp3?token=t3', remainingTime: 0 });
  await run;
  assert.equal(p.calls.filter(([n]) => n === 'Load').length, 2, 'full translation reloads audio even on same pathname');
  assert.equal(p.plugin.state().partial, false);
  assert.match(p.plugin.state().message, /Перевод готов/);
});

test('sync: rate-nudges small drift, locks exact rate within 60ms, and uses compensated seek without overlapping while seeking', async (t) => {
  const p = translationPage(t, [{ translated: true, url: 'https://audio' }]);
  await p.plugin.start();

  // Audio lags by 0.25s -> speed up (rate > 1), no seek
  p.calls.length = 0;
  p.video.currentTime = 10.25;
  p.setAudio({ state: 'playing', position: 10.0, seeking: false });
  p.plugin.sync();
  const up = p.calls.find(([n]) => n === 'Rate');
  assert.ok(up && up[1] > 1.05 && up[1] <= 1.08);
  assert.equal(p.calls.some(([n]) => n === 'Seek'), false);

  // Audio leads by 0.25s -> slow down (rate < 1)
  p.calls.length = 0;
  p.video.currentTime = 10.0;
  p.setAudio({ state: 'playing', position: 10.25, seeking: false });
  p.plugin.sync();
  const down = p.calls.find(([n]) => n === 'Rate');
  assert.ok(down && down[1] < 0.95 && down[1] >= 0.92);
  assert.equal(p.calls.some(([n]) => n === 'Seek'), false);

  // Within 60ms -> lock back to 1.0
  p.calls.length = 0;
  p.video.currentTime = 10.03;
  p.setAudio({ state: 'playing', position: 10.0, seeking: false });
  p.plugin.sync();
  assert.deepEqual(p.calls.find(([n]) => n === 'Rate'), ['Rate', 1]);

  // Large drift (> 0.55s) -> seek with +0.20s latency compensation, suppressed while seeking=true
  p.calls.length = 0;
  p.video.currentTime = 50.0;
  p.setAudio({ state: 'playing', position: 10.0, seeking: false });
  p.plugin.sync();
  const seek = p.calls.find(([n]) => n === 'Seek');
  assert.ok(seek && Math.abs(seek[1] - 50.2) < 0.01);

  p.calls.length = 0;
  p.video.currentTime = 90.0;
  p.setAudio({ state: 'playing', position: 50.2, seeking: true });
  p.plugin.sync();
  assert.equal(p.calls.some(([n]) => n === 'Seek'), false, 'no overlapping seek while seeking=true');
});

test('lively voice: maps auto->en for ru and falls back to standard voice on unavailable error', async (t) => {
  const p = translationPage(t, [
    () => { const err = new Error('Попробуйте позже'); err.data = { message: 'Для этого видео доступна только обычная озвучка' }; throw err; },
    { translated: true, url: 'https://audio', remainingTime: -1 },
  ]);
  await p.plugin.start();
  assert.equal(p.translateArgs.length, 2);
  assert.equal(p.translateArgs[0].requestLang, 'en');
  assert.equal(p.translateArgs[0].extraOpts.useLivelyVoice, true);
  assert.equal(p.translateArgs[1].requestLang, 'auto');
  assert.equal(p.translateArgs[1].extraOpts.useLivelyVoice, false);
  assert.equal(p.plugin.state().phase, 'ready');
});

test('lively voice: status=7 (Yandex auth required) falls back to standard voice', async (t) => {
  const p = translationPage(t, [
    () => { const err = new Error('Yandex auth required to translate video. See docs for more info'); err.data = { status: 7, isLivelyVoice: true }; throw err; },
    { translated: true, url: 'https://audio', remainingTime: -1 },
  ]);
  await p.plugin.start();
  assert.equal(p.translateArgs.length, 2);
  assert.equal(p.translateArgs[0].extraOpts.useLivelyVoice, true);
  assert.equal(p.translateArgs[1].extraOpts.useLivelyVoice, false);
  assert.equal(p.plugin.state().phase, 'ready');
});

test('lively voice: disabled for non-English explicit source language and rejects same-language translation locally', async (t) => {
  const p = translationPage(t, [{ translated: true, url: 'https://audio', remainingTime: -1 }]);
  p.votv.settings.set('vot.from', 'de');
  await p.plugin.start();
  assert.equal(p.translateArgs.length, 1);
  assert.equal(p.translateArgs[0].extraOpts.useLivelyVoice, false);

  p.translateArgs.length = 0;
  p.votv.settings.set('vot.from', 'ru');
  p.votv.settings.set('vot.to', 'ru');
  await p.plugin.start();
  assert.equal(p.translateArgs.length, 0, 'same-language pair must not hit Yandex');
  assert.equal(p.plugin.state().phase, 'error');
  assert.match(p.plugin.state().message, /Автоопределение/);
});

test('proxy fallback: status=7 with standard voice in auto mode retries via VOT proxy', async (t) => {
  const p = translationPage(t, [
    () => { const err = new Error('Yandex auth required to translate video. See docs for more info'); err.data = { status: 7, isLivelyVoice: true }; throw err; },
    () => { const err = new Error('Yandex auth required to translate video. See docs for more info'); err.data = { status: 7 }; throw err; },
    { translated: true, url: 'https://audio', remainingTime: -1 },
  ]);
  await p.plugin.start();
  assert.equal(p.instances(), 2);
  assert.equal(p.plugin.state().proxy, true);
  assert.equal(p.plugin.state().phase, 'ready');
});

test('AUDIO_REQUESTED: downloads captured YouTube audio stream and uploads via requestVtransAudio', async (t) => {
  const audioBytes = Buffer.from([10, 20, 30, 40]);
  const p = translationPage(t, [
    { translated: false, status: 6, translationId: 'tid-1', remainingTime: 120 },
    { translated: true, url: 'https://audio', remainingTime: -1 },
  ], {
    request: async (req) => {
      assert.equal(req.url, 'https://googlevideo.example/audio');
      return { status: 200, bodyBase64: audioBytes.toString('base64') };
    },
  });
  p.emitJson({
    videoDetails: { videoId: '8wv3JJNc-h4', title: 'Test Video' },
    streamingData: { adaptiveFormats: [
      { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, url: 'https://googlevideo.example/m4a' },
      { itag: 249, mimeType: 'audio/webm; codecs="opus"', bitrate: 48000, url: 'https://googlevideo.example/audio' },
    ] },
  });
  await p.plugin.start();
  assert.equal(p.uploadCalls.length, 1);
  assert.equal(p.uploadCalls[0][1], 'tid-1');
  assert.deepEqual([...p.uploadCalls[0][2].audioFile], [10, 20, 30, 40]);
  assert.equal(p.failCalls.length, 0);
  assert.equal(p.plugin.state().phase, 'ready');
});

test('AUDIO_REQUESTED: falls back to requestVtransFailAudio when no audio stream is captured', async (t) => {
  const p = translationPage(t, [
    { translated: false, status: 6, translationId: 'tid-2', remainingTime: 120 },
    { translated: true, url: 'https://audio', remainingTime: -1 },
  ]);
  await p.plugin.start();
  assert.equal(p.failCalls.length, 1);
  assert.equal(p.uploadCalls.length, 1);
  assert.equal(p.uploadCalls[0][2].audioFile.byteLength, 0);
});

test('proxifyAudioUrl: rewrites Yandex S3 URL and AudioPlayer error triggers proxy retry once', async (t) => {
  const raw = 'https://vtrans.s3-private.mds.yandex.net/tts/prod/abc.mp3';
  assert.equal(proxifyAudioUrl(raw), 'https://vot-worker.eu.cc/video-translation/audio-proxy/abc.mp3');
  const p = translationPage(t, [{ translated: true, url: raw, remainingTime: -1 }]);
  await p.plugin.start();
  p.setAudio({ state: 'error', error: '403' });
  p.plugin.sync();
  const loads = p.calls.filter(([n]) => n === 'Load');
  assert.equal(loads.length, 2);
  assert.equal(loads[0][1], raw);
  assert.equal(loads[1][1], 'https://vot-worker.eu.cc/video-translation/audio-proxy/abc.mp3');
  assert.equal(p.plugin.state().phase, 'ready');
});

test('subtitles: parses Yandex JSON and WebVTT and renders active cues on sync', async (t) => {
  assert.deepEqual(parseSubtitlesPayload(JSON.stringify({
    subtitles: [{ text: 'Привет', startMs: 8000, durationMs: 5000 }],
  })), [{ start: 8, end: 13, text: 'Привет' }]);
  assert.deepEqual(parseSubtitlesPayload('WEBVTT\n\n00:00:08.000 --> 00:00:13.000\n<b>Мир</b>'), [
    { start: 8, end: 13, text: 'Мир' },
  ]);

  const p = translationPage(t, [], {
    subtitlesResponse: { waiting: false, subtitles: [{ language: 'en', url: 'https://subs/en', translatedLanguage: 'ru', translatedUrl: 'https://subs/ru' }] },
    request: async () => ({
      status: 200, headers: {},
      bodyBase64: Buffer.from(JSON.stringify({ subtitles: [{ text: 'Тест субтитров', startMs: 5000, durationMs: 10000 }] })).toString('base64'),
    }),
  });
  await p.plugin.loadSubtitleTracks('8wv3JJNc-h4');
  assert.equal(p.plugin.state().subTracks.length, 2);
  await p.plugin.selectSubtitles('tr:ru');
  const overlay = p.created.find((e) => e.id === 'votv-subs');
  assert.ok(overlay);
  assert.equal(overlay.textContent, 'Тест субтитров');
  assert.equal(overlay.style.display, 'block');
  p.video.currentTime = 20;
  p.plugin.sync();
  assert.equal(overlay.style.display, 'none');
});

function fakeVotv(respond) {
  const requests = [];
  return {
    requests,
    request: async (req) => { requests.push(req); return respond(req); },
  };
}

test('hostFetch: binary body and headers go to the host as base64', async () => {
  const votv = fakeVotv(() => ({ status: 200, headers: { 'content-type': 'application/x-protobuf' }, bodyBase64: Buffer.from([1, 2, 3]).toString('base64') }));
  const fetch = makeHostFetch(votv);
  const res = await fetch('https://api.example/x', { method: 'POST', headers: { 'Vtrans-Signature': 'abc' }, body: new Blob([new Uint8Array([9, 8, 7])]) });
  const req = votv.requests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['Vtrans-Signature'], 'abc');
  assert.deepEqual([...Buffer.from(req.bodyBase64, 'base64')], [9, 8, 7]);
  assert.equal(req.responseType, 'base64');
  assert.equal(res.status, 200);
  assert.equal(res.ok, true);
  assert.equal(res.headers.get('Content-Type'), 'application/x-protobuf');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
});

test('hostFetch: text and json bodies; Headers objects', async () => {
  const votv = fakeVotv(() => ({ status: 200, bodyBase64: Buffer.from('{"ok":1}').toString('base64') }));
  const fetch = makeHostFetch(votv);
  const res = await fetch('https://x/y', { method: 'POST', headers: new Headers({ A: '1' }), body: '{"q":2}' });
  assert.equal(votv.requests[0].body, '{"q":2}');
  assert.equal(votv.requests[0].headers.a, '1');
  assert.deepEqual(await res.json(), { ok: 1 });
});

test('hostFetch: a host network error rejects like fetch does', async () => {
  const fetch = makeHostFetch(fakeVotv(() => ({ status: 0, error: 'SocketTimeoutException' })));
  await assert.rejects(fetch('https://x/'), /network error: SocketTimeoutException/);
});

test('hostFetch: HTTP errors resolve with their status (not ok)', async () => {
  const fetch = makeHostFetch(fakeVotv(() => ({ status: 402, bodyBase64: Buffer.from('(error_id:1)').toString('base64') })));
  const res = await fetch('https://x/');
  assert.equal(res.status, 402);
  assert.equal(res.ok, false);
  assert.equal(await res.text(), '(error_id:1)');
});

test('works with the real @vot.js/core: a session request is signed and sent through the host', async () => {
  const { default: VOTClient } = await import('@vot.js/core');
  const votv = fakeVotv(() => ({ status: 500, bodyBase64: '' }));
  const client = new VOTClient({ fetchFn: makeHostFetch(votv) });
  await assert.rejects(client.translateVideo({ videoData: { url: 'https://youtu.be/dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', host: 'youtube', duration: 213 } }));
  const req = votv.requests[0];
  assert.match(req.url, /^https:\/\/api\.browser\.yandex\.ru\/session\/create$/);
  assert.equal(req.method, 'POST');
  assert.ok(req.headers['Vtrans-Signature'] || req.headers['vtrans-signature'], 'signed');
  assert.ok(req.bodyBase64.length > 10, 'protobuf body');
});
