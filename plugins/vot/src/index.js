/* Yandex voice-over translation for youtube.com/tv.
 *
 * Protocol: @vot.js/core (the library of voice-over-translation by ilyhalight / FOSWLY), with
 * our fetch going through the VOTV host (no CORS). Includes lively voices, audio upload on
 * AUDIO_REQUESTED, worker audio proxy fallback, and VOT subtitles overlay.
 *
 * Built with esbuild into dist/vot.js (plugins/vot/build.mjs). */
import VOTClient from '@vot.js/core';
import { VOTWorkerProvider } from '@vot.js/core/providers/votworker';
import { config as votConfig } from '@vot.js/shared';

const WORKER_HOST = 'vot-worker.eu.cc';
const AUDIO_SOURCE_PREFIX = 'https://vtrans.s3-private.mds.yandex.net/tts/prod/';
const SUBTITLE_SOURCE_PREFIX = 'https://brosubs.s3-private.mds.yandex.net/vtrans/';
const MIN_CHUNK_SIZE = (votConfig && votConfig.minChunkSize) || 5295308;

// ---- helpers --------------------------------------------------------------------------
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  const bin = atob(b64 || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function proxifyAudioUrl(url, workerHost = WORKER_HOST) {
  if (typeof url === 'string' && url.startsWith(AUDIO_SOURCE_PREFIX)) {
    return `https://${workerHost}/video-translation/audio-proxy/${url.slice(AUDIO_SOURCE_PREFIX.length)}`;
  }
  return url;
}

export function proxifySubtitlesUrl(url, workerHost = WORKER_HOST) {
  if (typeof url === 'string' && url.startsWith(SUBTITLE_SOURCE_PREFIX)) {
    return `https://${workerHost}/video-subtitles/subtitles-proxy/${url.slice(SUBTITLE_SOURCE_PREFIX.length)}`;
  }
  return url;
}

function parseTimestamp(str) {
  const clean = String(str || '').trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

export function parseSubtitlesPayload(raw) {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json.subtitles)) {
        return json.subtitles
          .filter((s) => s && typeof s.text === 'string' && s.text.trim())
          .map((s) => ({
            start: Number(s.startMs || 0) / 1000,
            end: (Number(s.startMs || 0) + Number(s.durationMs || 0)) / 1000,
            text: s.text.trim(),
          }))
          .filter((c) => Number.isFinite(c.start) && c.end > c.start)
          .sort((a, b) => a.start - b.start);
      }
      if (Array.isArray(json.events)) {
        return json.events
          .map((ev) => ({
            start: Number(ev.tStartMs || 0) / 1000,
            end: (Number(ev.tStartMs || 0) + Number(ev.dDurationMs || 0)) / 1000,
            text: (ev.segs || []).map((s) => s.utf8 || '').join('').trim(),
          }))
          .filter((c) => c.text && Number.isFinite(c.start) && c.end > c.start)
          .sort((a, b) => a.start - b.start);
      }
    } catch (e) { /* fall through to VTT/SRT */ }
  }
  // WebVTT / SRT
  const cues = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;
    const [left, rightRaw] = lines[timingIdx].split('-->');
    const right = (rightRaw || '').trim().split(/\s+/)[0];
    const start = parseTimestamp(left);
    const end = parseTimestamp(right);
    const body = lines.slice(timingIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (body && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      cues.push({ start, end, text: body });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

// ---- fetch through the host -----------------------------------------------------------
export function makeHostFetch(votv) {
  return async function hostFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url || String(input);
    const headers = {};
    const h = init.headers || {};
    if (typeof h.forEach === 'function') h.forEach((v, k) => { headers[k] = v; });
    else Object.assign(headers, h);
    const req = { url, method: init.method || 'GET', headers, responseType: 'base64', timeout: init.timeout || 30000 };
    const body = init.body;
    if (body != null) {
      if (typeof body === 'string') req.body = body;
      else if (body instanceof ArrayBuffer) req.bodyBase64 = toBase64(new Uint8Array(body));
      else if (ArrayBuffer.isView(body)) req.bodyBase64 = toBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
      else if (typeof body.arrayBuffer === 'function') req.bodyBase64 = toBase64(new Uint8Array(await body.arrayBuffer()));
      else req.body = String(body);
    }
    const r = await votv.request(req);
    if (!r.status) throw new TypeError(`network error: ${r.error || 'no response'}`);
    const bytes = fromBase64(r.bodyBase64);
    const text = () => new TextDecoder().decode(bytes);
    const resHeaders = r.headers || {};
    return {
      status: r.status, ok: r.status >= 200 && r.status < 300, url,
      headers: { get: (k) => resHeaders[String(k).toLowerCase()] ?? null, has: (k) => String(k).toLowerCase() in resHeaders },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => text(),
      json: async () => JSON.parse(text()),
      clone() { return this; },
    };
  };
}

// ---- plugin ---------------------------------------------------------------------------
export function createVotPlugin(votv, Client = VOTClient) {
  const { settings, ui, player } = votv;
  const host = window.VotHost;
  if (!host || typeof host.audioLoad !== 'function') {
    votv.warn('vot: this APK has no audio player (host API < 3)');
    return {};
  }

  const LANGS_TO = [['ru', 'Русский'], ['en', 'English'], ['kk', 'Қазақша']];
  const LANGS_FROM = [['auto', 'Автоопределение'], ['en', 'English'], ['ru', 'Русский'], ['de', 'Deutsch'], ['fr', 'Français'],
    ['es', 'Español'], ['it', 'Italiano'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'], ['ar', 'العربية']];
  const PERCENT = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => [n, `${n}%`]);

  settings.define({ id: 'vot.auto', type: 'bool', group: 'Дубляж Яндекса', title: 'Переводить автоматически', summary: 'Включать перевод для каждого нового видео', default: false });
  settings.define({ id: 'vot.to', type: 'choice', group: 'Дубляж Яндекса', title: 'Язык перевода', default: 'ru', options: LANGS_TO });
  settings.define({ id: 'vot.from', type: 'choice', group: 'Дубляж Яндекса', title: 'Язык видео', default: 'auto', options: LANGS_FROM });
  settings.define({ id: 'vot.livelyVoice', type: 'bool', group: 'Дубляж Яндекса', title: 'Живые голоса', summary: 'Естественная интонация и эмоции (для русского перевода)', default: true });
  settings.define({ id: 'vot.audioDownload', type: 'bool', group: 'Дубляж Яндекса', title: 'Загружать аудио для новых видео', summary: 'Отправлять аудиопоток Яндексу, если видео ещё не переводилось', default: true });
  settings.define({ id: 'vot.volume', type: 'choice', group: 'Дубляж Яндекса', title: 'Громкость перевода', default: 100, options: PERCENT });
  settings.define({ id: 'vot.original', type: 'choice', group: 'Дубляж Яндекса', title: 'Громкость оригинала', summary: 'Пока звучит перевод', default: 20, options: PERCENT });
  settings.define({ id: 'vot.proxy', type: 'choice', group: 'Дубляж Яндекса', title: 'Подключение к Яндексу', summary: 'Через прокси VOT, если Яндекс не отвечает напрямую', default: 'auto',
    options: [['auto', 'Автоматически'], ['direct', 'Напрямую'], ['proxy', 'Через прокси VOT']] });

  // ---- capture player metadata (title + lowest-bitrate direct audio stream) -----------
  const videoMeta = new Map(); // videoId -> { title, audio: { url, contentLength, mimeType, itag } | null }
  function pickAudioFormat(adaptiveFormats) {
    if (!Array.isArray(adaptiveFormats)) return null;
    const candidates = adaptiveFormats.filter((f) => f && typeof f.url === 'string' && f.url.startsWith('http') && typeof f.mimeType === 'string' && f.mimeType.startsWith('audio/'));
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const aWebm = a.mimeType.includes('webm') ? 0 : 1;
      const bWebm = b.mimeType.includes('webm') ? 0 : 1;
      if (aWebm !== bWebm) return aWebm - bWebm;
      return (Number(a.bitrate) || 999999) - (Number(b.bitrate) || 999999);
    });
    const best = candidates[0];
    return { url: best.url, contentLength: Number(best.contentLength) || 0, mimeType: best.mimeType, itag: best.itag };
  }
  function capturePlayerObject(p) {
    if (!p || typeof p !== 'object') return;
    const d = p.videoDetails;
    const id = d && d.videoId;
    if (!id) return;
    const audio = pickAudioFormat(p.streamingData && p.streamingData.adaptiveFormats);
    const prev = videoMeta.get(id) || {};
    videoMeta.set(id, { title: d.title || prev.title || '', audio: audio || prev.audio || null });
    if (videoMeta.size > 20) videoMeta.delete(videoMeta.keys().next().value);
  }
  if (votv.hooks && typeof votv.hooks.json === 'function') {
    votv.hooks.json((o) => {
      if (o.videoDetails || o.streamingData) capturePlayerObject(o);
      if (o.playerResponse && typeof o.playerResponse === 'object') capturePlayerObject(o.playerResponse);
    });
  }

  const hostFetch = makeHostFetch(votv);
  let proxyActive = settings.get('vot.proxy') === 'proxy';
  const clients = new Map();
  function client() {
    const key = proxyActive ? 'proxy' : 'direct';
    if (!clients.has(key)) clients.set(key, proxyActive
      ? new Client({ fetchFn: hostFetch, host: WORKER_HOST, provider: VOTWorkerProvider })
      : new Client({ fetchFn: hostFetch }));
    return clients.get(key);
  }
  settings.onChange('vot.proxy', (m) => { proxyActive = m === 'proxy'; });

  // ---- state --------------------------------------------------------------------------
  // phase: off | translating | ready | error
  const st = {
    phase: 'off', videoId: player.videoId() || '', message: '', eta: 0, url: '', rawUrl: '',
    partial: false, partialKey: '', audioDuration: 0, run: 0, audioProxied: false, usedLivelyVoice: false,
    subId: 'off', subTracks: [], subCues: [], subLoading: false,
  };
  const uploadedTranslations = new Set();
  const failedAudioSent = new Set();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const urlKey = (url) => String(url || '').split('?')[0].split('#')[0];
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function partialStatusText() {
    const v = player.video();
    const etaStr = st.eta > 0 ? ` (~${Math.ceil(st.eta)} с)` : '';
    if (st.audioDuration > 0 && v && v.currentTime >= st.audioDuration - 0.5) {
      return `Переведена часть видео (до ${fmtTime(st.audioDuration)}) · ждём остальное${etaStr}`;
    }
    if (st.audioDuration > 0) {
      return `Переведена часть видео (до ${fmtTime(st.audioDuration)})${etaStr}`;
    }
    return `Переведена часть видео · догружаем${etaStr}`;
  }
  const setStatus = (phase, message, eta = 0) => {
    if (st.phase === phase && st.message === message && st.eta === eta) return;
    st.phase = phase; st.message = message; st.eta = eta; ui.panel.refresh();
  };

  function isSessionRequired(val) {
    if (!val) return false;
    if (val.status === 7 || (val.data && val.data.status === 7)) return true;
    const parts = [val.message, val.data && val.data.message, val.error];
    return parts.filter(Boolean).join(' ').toLowerCase().includes('yandex auth required');
  }

  function isLivelyUnavailable(val) {
    if (!val) return false;
    if (isSessionRequired(val)) return true;
    const parts = [val.message, val.data && val.data.message, val.error];
    const msg = parts.filter(Boolean).join(' ').toLowerCase();
    return msg.includes('обычная озвучка') || (msg.includes('lively') && msg.includes('unavailable'));
  }

  async function callWithProxyFallback(fn) {
    try {
      return await fn(client());
    } catch (e) {
      const refused = /Failed to request|network error/i.test(String(e && e.message));
      if (!proxyActive && refused && settings.get('vot.proxy') === 'auto') {
        votv.log('vot: direct request refused, switching to the VOT proxy');
        proxyActive = true;
        return fn(client());
      }
      throw e;
    }
  }

  async function requestOnce(videoId, duration, livelyDisabled) {
    const reqLang = settings.get('vot.from');
    const resLang = settings.get('vot.to');
    const meta = videoMeta.get(videoId);
    const shouldSendFailedAudio = !settings.get('vot.audioDownload');
    let useLively = !livelyDisabled && Boolean(settings.get('vot.livelyVoice')) && resLang === 'ru' && (reqLang === 'auto' || reqLang === 'en');

    while (true) {
      const apiReqLang = useLively && reqLang === 'auto' && resLang === 'ru' ? 'en' : reqLang;
      const params = {
        videoData: { url: `https://youtu.be/${videoId}`, videoId, host: 'youtube', duration },
        requestLang: apiReqLang,
        responseLang: resLang,
        extraOpts: { useLivelyVoice: useLively, videoTitle: (meta && meta.title) || '' },
        shouldSendFailedAudio,
      };
      try {
        const res = await callWithProxyFallback((c) => c.translateVideo(params));
        if (useLively && isLivelyUnavailable(res)) {
          votv.log('vot: lively voice unavailable in response, falling back to standard voice');
          useLively = false;
          livelyDisabled = true;
          continue;
        }
        return { res, usedLivelyVoice: useLively, livelyDisabled };
      } catch (e) {
        if (useLively && isLivelyUnavailable(e)) {
          votv.log('vot: lively voice unavailable in error, falling back to standard voice');
          useLively = false;
          livelyDisabled = true;
          continue;
        }
        if (!proxyActive && isSessionRequired(e) && settings.get('vot.proxy') === 'auto') {
          votv.log('vot: session required directly, retrying via VOT proxy');
          proxyActive = true;
          continue;
        }
        throw e;
      }
    }
  }

  async function uploadAudioForTranslation(videoId, translationId, isActive) {
    const c = client();
    const provider = c.provider;
    if (!provider || typeof provider.requestVtransAudio !== 'function') return false;
    const videoUrl = `https://youtu.be/${videoId}`;
    const meta = videoMeta.get(videoId);
    const stream = meta && meta.audio;
    if (stream && stream.url && settings.get('vot.audioDownload')) {
      try {
        setStatus('translating', 'Загружаем аудио для перевода…');
        const total = stream.contentLength;
        const fileId = `votv-audio:${videoId}:${stream.itag || 0}`;
        if (total > MIN_CHUNK_SIZE) {
          const totalChunks = Math.ceil(total / MIN_CHUNK_SIZE);
          for (let chunkId = 0; chunkId < totalChunks; chunkId++) {
            if (!isActive()) return false;
            const start = chunkId * MIN_CHUNK_SIZE;
            const end = Math.min(total - 1, start + MIN_CHUNK_SIZE - 1);
            const r = await votv.request({
              url: stream.url, method: 'GET', responseType: 'base64', timeout: 60000,
              headers: { Range: `bytes=${start}-${end}` },
            });
            if (!r.status || r.status >= 400 || !r.bodyBase64) {
              throw new Error(`audio download ${r.status} ${r.error || ''}`);
            }
            const bytes = fromBase64(r.bodyBase64);
            await provider.requestVtransAudio(
              videoUrl, translationId,
              { audioFile: bytes, chunkId },
              { audioPartsLength: totalChunks, fileId, version: 1 },
            );
          }
          votv.log(`vot: uploaded ${totalChunks} audio chunks for ${videoId}`);
          return true;
        }
        const r = await votv.request({ url: stream.url, method: 'GET', responseType: 'base64', timeout: 60000 });
        if (!r.status || r.status >= 400 || !r.bodyBase64) {
          throw new Error(`audio download ${r.status} ${r.error || ''}`);
        }
        const bytes = fromBase64(r.bodyBase64);
        if (bytes.byteLength > MIN_CHUNK_SIZE) {
          const totalChunks = Math.ceil(bytes.byteLength / MIN_CHUNK_SIZE);
          for (let chunkId = 0; chunkId < totalChunks; chunkId++) {
            if (!isActive()) return false;
            const slice = bytes.subarray(chunkId * MIN_CHUNK_SIZE, Math.min(bytes.byteLength, (chunkId + 1) * MIN_CHUNK_SIZE));
            await provider.requestVtransAudio(
              videoUrl, translationId,
              { audioFile: slice, chunkId },
              { audioPartsLength: totalChunks, fileId, version: 1 },
            );
          }
        } else {
          await provider.requestVtransAudio(videoUrl, translationId, { audioFile: bytes, fileId });
        }
        votv.log(`vot: uploaded ${Math.round(bytes.byteLength / 1024)} KB audio for ${videoId}`);
        return true;
      } catch (e) {
        votv.warn('vot: audio download/upload failed, falling back to fail-audio-js:', (e && e.message) || e);
      }
    }
    if (!isActive() || failedAudioSent.has(videoUrl)) return false;
    failedAudioSent.add(videoUrl);
    if (typeof provider.requestVtransFailAudio === 'function') {
      await provider.requestVtransFailAudio(videoUrl);
    }
    await provider.requestVtransAudio(videoUrl, translationId, {
      audioFile: new Uint8Array(0),
      fileId: `fallback-empty-audio:video-translation:${videoId}`,
    });
    votv.log(`vot: sent fail-audio fallback for ${videoId}`);
    return true;
  }

  async function start() {
    const videoId = player.videoId();
    const v = player.video();
    if (!videoId || !v) { votv.toast('Сначала откройте видео'); return; }
    const run = ++st.run;
    const startedAt = Date.now();
    st.videoId = videoId;
    st.url = '';
    st.rawUrl = '';
    st.partial = false;
    st.partialKey = '';
    st.audioDuration = 0;
    st.audioProxied = false;
    stopAudio();
    if (settings.get('vot.from') !== 'auto' && settings.get('vot.from') === settings.get('vot.to')) {
      const msg = 'Язык видео совпадает с языком перевода — выберите «Автоопределение»';
      setStatus('error', msg);
      votv.toast(msg, 4000);
      return;
    }
    setStatus('translating', 'Запрашиваем перевод…');
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration) : undefined;
    let livelyDisabled = false;
    try {
      for (let attempt = 0; run === st.run; attempt++) {
        const requestAt = Date.now();
        const { res, usedLivelyVoice, livelyDisabled: nextLivelyDisabled } = await requestOnce(videoId, duration, livelyDisabled);
        livelyDisabled = nextLivelyDisabled;
        st.usedLivelyVoice = usedLivelyVoice;
        if (run !== st.run) return;
        votv.log(`vot: request ${Date.now() - requestAt}ms status=${res.status} eta=${res.remainingTime} lively=${usedLivelyVoice} elapsed=${Date.now() - startedAt}ms`);
        if (res.translated && res.url) {
          const full = !(res.remainingTime > 0);
          const key = urlKey(res.url);
          const shouldLoad = full || !st.rawUrl || key !== st.partialKey;
          st.partial = !full;
          st.partialKey = key;
          const eta = full ? 0 : (res.remainingTime > 0 ? res.remainingTime : 0);
          st.eta = eta;
          if (shouldLoad) playAudio(res.url);
          const voiceTag = usedLivelyVoice ? ' · живой голос' : '';
          setStatus('ready', full ? `Перевод готов${voiceTag}` : partialStatusText(), eta);
          if (full) { votv.log(`vot: translation ready for ${videoId}`); return; }
        } else if (res.status === 6 && res.translationId && !uploadedTranslations.has(res.translationId)) {
          uploadedTranslations.add(res.translationId);
          await uploadAudioForTranslation(videoId, res.translationId, () => run === st.run);
          if (run !== st.run) return;
          setStatus('translating', 'Аудио отправлено, Яндекс переводит…');
          await sleep(3000);
          continue;
        } else {
          const eta = res.remainingTime > 0 ? res.remainingTime : 0;
          if (!st.url) setStatus('translating', eta ? `Оценка Яндекса: ~${Math.ceil(eta)} с · проверяем готовность` : 'Яндекс готовит перевод…', eta);
        }
        const wait = st.partial ? 10 : Math.max(3, Math.min(10, res.remainingTime > 0 ? res.remainingTime : 5));
        await sleep(wait * 1000);
        if (attempt > 120) throw new Error('слишком долго');
      }
    } catch (e) {
      if (run !== st.run) return;
      const data = e && e.data;
      const rawMsg = (data && data.message) || (e && e.message) || String(e);
      const msg = /yandex auth required/i.test(rawMsg) ? 'Яндекс запросил авторизацию для этого видео' : rawMsg;
      votv.warn('vot: translation failed', msg);
      stopAudio();
      setStatus('error', `Не удалось перевести: ${msg}`);
      votv.toast(`Перевод: ${msg}`, 5000);
    }
  }

  function stop() {
    st.run++;
    st.partial = false;
    st.partialKey = '';
    st.audioDuration = 0;
    stopAudio();
    setStatus('off', '');
  }

  // ---- subtitles ----------------------------------------------------------------------
  let subOverlay = null, lastSubText = '';
  function ensureSubOverlay() {
    if (subOverlay || typeof document === 'undefined' || !document.body) return subOverlay;
    subOverlay = document.createElement('div');
    subOverlay.id = 'votv-subs';
    subOverlay.style.cssText = 'position:fixed;left:50%;bottom:11%;transform:translateX(-50%);z-index:2147483500;' +
      'pointer-events:none;max-width:78%;text-align:center;display:none;padding:10px 18px;border-radius:10px;' +
      'background:rgba(16,16,16,.88);border:1px solid rgba(255,255,255,.12);color:#f1f1f1;' +
      'font-family:"YouTube Sans",Roboto,Arial,sans-serif;font-size:28px;font-weight:500;line-height:1.35;white-space:pre-line';
    document.body.appendChild(subOverlay);
    return subOverlay;
  }
  function renderSubText(text) {
    if (text === lastSubText) return;
    lastSubText = text;
    const el = ensureSubOverlay();
    if (!el) return;
    if (!text) { el.style.display = 'none'; el.textContent = ''; return; }
    el.textContent = text;
    el.style.display = 'block';
  }
  function syncSubtitles() {
    if (st.subId === 'off' || !st.subCues.length) { renderSubText(''); return; }
    const v = player.video();
    if (!v || player.videoId() !== st.videoId) { renderSubText(''); return; }
    const t = v.currentTime;
    const active = st.subCues.filter((c) => t >= c.start && t <= c.end);
    renderSubText(active.map((c) => c.text).join('\n'));
  }

  async function loadSubtitleTracks(videoId) {
    if (!videoId) { st.subTracks = []; st.subCues = []; st.subId = 'off'; renderSubText(''); return; }
    st.subLoading = true;
    try {
      const c = client();
      if (typeof c.getSubtitles !== 'function') return;
      const reqLang = settings.get('vot.from');
      const res = await callWithProxyFallback((cl) => cl.getSubtitles({
        videoData: { url: `https://youtu.be/${videoId}`, videoId, host: 'youtube' },
        requestLang: reqLang,
      }));
      if (player.videoId() !== videoId) return;
      const tracks = [];
      for (const s of (res && res.subtitles) || []) {
        if (s.translatedUrl) {
          tracks.push({ id: `tr:${s.translatedLanguage || 'ru'}`, label: `${s.translatedLanguage || 'ru'} (перевод)`, url: s.translatedUrl });
        }
        if (s.url) {
          tracks.push({ id: `orig:${s.language}`, label: `${s.language} (оригинал)`, url: s.url });
        }
      }
      st.subTracks = tracks;
    } catch (e) {
      votv.warn('vot: subtitles list failed', (e && e.message) || e);
    } finally {
      st.subLoading = false;
      ui.panel.refresh();
    }
  }

  async function selectSubtitles(id) {
    st.subId = id || 'off';
    st.subCues = [];
    renderSubText('');
    if (st.subId === 'off') { ui.panel.refresh(); return; }
    const videoId = player.videoId();
    if (!st.subTracks.length && videoId) await loadSubtitleTracks(videoId);
    const track = st.subTracks.find((t) => t.id === st.subId);
    if (!track) { st.subId = 'off'; ui.panel.refresh(); return; }
    try {
      const url = settings.get('vot.proxy') === 'proxy' ? proxifySubtitlesUrl(track.url) : track.url;
      let res = await hostFetch(url);
      if (!res.ok && url === track.url) res = await hostFetch(proxifySubtitlesUrl(track.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      if (player.videoId() === videoId && st.subId === id) {
        st.videoId = videoId;
        st.subCues = parseSubtitlesPayload(raw);
        syncSubtitles();
      }
    } catch (e) {
      votv.warn('vot: subtitle fetch failed', (e && e.message) || e);
      votv.toast('Не удалось загрузить субтитры');
      st.subId = 'off';
    }
    ui.panel.refresh();
  }

  // ---- audio + sync -------------------------------------------------------------------
  let ducked = null, duckedVideo = null;
  let audioRequestedAt = 0, lastSeekAt = 0, seekStartedAt = 0, lastSig = '', lastRate = 0;
  function playAudio(url, isProxyRetry = false) {
    const v = player.video();
    if (!isProxyRetry) {
      st.rawUrl = url;
      st.audioProxied = settings.get('vot.proxy') === 'proxy';
    } else {
      st.audioProxied = true;
    }
    const finalUrl = st.audioProxied ? proxifyAudioUrl(url) : url;
    st.url = finalUrl;
    audioRequestedAt = Date.now();
    lastRate = 0;
    lastSeekAt = 0;
    seekStartedAt = 0;
    host.audioVolume(settings.get('vot.volume') / 100);
    host.audioLoad(finalUrl, v ? v.currentTime : 0);
  }
  function stopAudio() {
    host.audioRelease();
    restoreOriginal();
    lastSeekAt = 0;
    seekStartedAt = 0;
    lastRate = 0;
  }
  function restoreOriginal() {
    if (duckedVideo && ducked !== null) duckedVideo.volume = ducked;
    ducked = null;
    duckedVideo = null;
  }
  function setAudioRate(r) {
    if (Math.abs(r - lastRate) > 0.002) {
      lastRate = r;
      host.audioRate(r);
    }
  }

  function sync() {
    syncSubtitles();
    if (st.phase !== 'ready' || !st.url) return;
    const v = player.video();
    if (!v || player.videoId() !== st.videoId) return;
    let a;
    try { a = JSON.parse(host.audioState()); } catch (e) { return; }
    const sig = `${a.state}|${v.paused}|${v.readyState}|${v.seeking}|${!!a.seeking}`;
    if (sig !== lastSig) { lastSig = sig; votv.log(`vot: audio ${a.state} pos=${a.position.toFixed(1)} video=${v.currentTime.toFixed(1)} paused=${v.paused} ready=${v.readyState}${a.seeking ? ' seeking' : ''}${a.error ? ' ' + a.error : ''}`); }
    if (a.state === 'error') {
      if (!st.audioProxied && st.rawUrl && st.rawUrl.startsWith(AUDIO_SOURCE_PREFIX)) {
        votv.log('vot: audio failed directly, retrying via VOT audio proxy');
        playAudio(st.rawUrl, true);
        return;
      }
      stopAudio();
      setStatus('error', `Ошибка воспроизведения: ${a.error || ''}`);
      return;
    }
    if (a.state === 'idle' || a.state === 'preparing') return;
    if (a.duration > 0) st.audioDuration = a.duration;
    if (st.partial && st.phase === 'ready') setStatus('ready', partialStatusText(), st.eta);
    if (a.state === 'ended' && v.currentTime >= a.duration - 0.5) { restoreOriginal(); return; }
    const target = settings.get('vot.original') / 100;
    if (ducked === null) { ducked = v.volume; duckedVideo = v; votv.log(`vot: audio prepared in ${Date.now() - audioRequestedAt}ms`); }
    if (Math.abs(v.volume - target) > 0.01) v.volume = target;

    const playing = !document.hidden && !v.paused && !v.seeking && v.readyState >= 3 && !v.ended;
    if (!playing) { if (a.state === 'playing') host.audioPause(); return; }

    const now = Date.now();
    if (a.seeking && now - seekStartedAt < 2500) {
      if (a.state !== 'playing') host.audioPlay();
      return;
    }

    const baseRate = v.playbackRate || 1;
    const drift = a.position - v.currentTime; // negative: audio behind video
    if (Math.abs(drift) > 0.55 && now - lastSeekAt > 1500) {
      lastSeekAt = now;
      seekStartedAt = now;
      const maxDur = a.duration > 0 ? a.duration - 0.1 : Infinity;
      const seekTarget = Math.max(0, Math.min(maxDur, v.currentTime + 0.20 * baseRate));
      setAudioRate(baseRate);
      host.audioSeek(seekTarget);
    } else if (Math.abs(drift) > 0.06) {
      const factor = Math.max(0.92, Math.min(1.08, 1 - drift * 0.35));
      setAudioRate(baseRate * factor);
    } else {
      setAudioRate(baseRate);
    }
    if (a.state !== 'playing') host.audioPlay();
  }
  setInterval(sync, 150);
  settings.onChange('vot.volume', (n) => host.audioVolume(n / 100));

  player.onVideoChange((id) => {
    if (st.phase !== 'off') stop();
    st.videoId = id;
    st.subId = 'off';
    st.subTracks = [];
    st.subCues = [];
    renderSubText('');
    if (id && settings.get('vot.auto')) setTimeout(() => { if (player.videoId() === id) start(); }, 1500);
  });
  settings.onChange('vot.to', () => { if (st.phase !== 'off') start(); });
  settings.onChange('vot.from', () => { if (st.phase !== 'off') start(); });
  settings.onChange('vot.livelyVoice', () => { if (st.phase !== 'off') start(); });

  // ---- panel --------------------------------------------------------------------------
  const statusHint = () => {
    if (st.phase === 'off') return settings.get('vot.auto') ? 'Автоперевод включён для новых видео' : 'Голосовой перевод от Яндекса';
    return st.message;
  };
  ui.panel.section({
    id: 'vot', order: 20, title: 'Дубляж Яндекса',
    rows: () => {
      const rows = [
        { kind: 'toggle', id: 'on', label: 'Закадровый перевод', hint: statusHint(), value: st.phase !== 'off', onChange: (on) => (on ? start() : stop()) },
      ];
      if (st.phase === 'error') {
        rows.push({ kind: 'button', id: 'retry', label: 'Повторить перевод', value: 'запустить', onPress: () => start() });
      }
      rows.push(
        { kind: 'select', id: 'to', label: 'Язык перевода', value: () => settings.get('vot.to'), options: LANGS_TO, onChange: (x) => settings.set('vot.to', x) },
        { kind: 'select', id: 'from', label: 'Язык видео', value: () => settings.get('vot.from'), options: LANGS_FROM, onChange: (x) => settings.set('vot.from', x) },
        { kind: 'select', id: 'subs', label: 'Субтитры VOT',
          hint: st.subLoading ? 'Загружаем список…' : (st.subTracks.length ? `${st.subTracks.length} дорожек` : 'Загрузятся при выборе'),
          value: () => st.subId,
          options: () => [['off', 'Выкл'], ...st.subTracks.map((t) => [t.id, t.label])],
          onChange: (x) => selectSubtitles(x) },
        { kind: 'select', id: 'vol', label: 'Громкость перевода', value: () => settings.get('vot.volume'), options: PERCENT, onChange: (x) => settings.set('vot.volume', x) },
        { kind: 'select', id: 'orig', label: 'Громкость оригинала', value: () => settings.get('vot.original'), options: PERCENT, onChange: (x) => settings.set('vot.original', x) },
        { kind: 'group', id: 'more', label: 'Дополнительно', rows: [
          { kind: 'toggle', id: 'auto', label: 'Переводить автоматически', hint: 'Для каждого нового видео', value: () => settings.get('vot.auto'), onChange: (x) => settings.set('vot.auto', x) },
          { kind: 'toggle', id: 'lively', label: 'Живые голоса', hint: 'Естественные голоса (для русского языка)', value: () => settings.get('vot.livelyVoice'), onChange: (x) => settings.set('vot.livelyVoice', x) },
          { kind: 'toggle', id: 'auddl', label: 'Загружать аудио для новых видео', hint: 'Обход ошибки на свежих видео', value: () => settings.get('vot.audioDownload'), onChange: (x) => settings.set('vot.audioDownload', x) },
          { kind: 'select', id: 'proxy', label: 'Подключение', value: () => settings.get('vot.proxy'), options: [['auto', 'Автоматически'], ['direct', 'Напрямую'], ['proxy', 'Через прокси VOT']], onChange: (x) => settings.set('vot.proxy', x) },
        ] },
      );
      return rows;
    },
  });

  // Expose subtitle refresh hook when user expands subtitles or opens panel while video is active
  if (player.onVideoChange) {
    player.onVideoChange((id) => {
      if (id) setTimeout(() => { if (player.videoId() === id && !st.subTracks.length) loadSubtitleTracks(id); }, 2500);
    });
  }

  return { start, stop, state: () => ({ ...st, proxy: proxyActive }), sync, selectSubtitles, loadSubtitleTracks };
}
__votv.define('vot', createVotPlugin);
