/* SponsorBlock: skips sponsor and other marked segments using the SponsorBlock database
 * (https://sponsor.ajay.app, data CC BY-NC-SA 4.0). Own client, not the extension's code.
 * Privacy: segments are looked up by the first 4 hex chars of sha256(videoId). */
__votv.define('sponsorblock', (votv) => {
  const { settings, ui, player } = votv;
  const API = 'https://sponsor.ajay.app/api/skipSegments';

  // category -> [label, default mode]; modes: auto (skip), manual (offer), off
  const CATEGORIES = [
    ['sponsor', 'Спонсорская реклама', 'auto'],
    ['selfpromo', 'Самореклама', 'auto'],
    ['interaction', 'Просьбы подписаться', 'auto'],
    ['intro', 'Заставка', 'manual'],
    ['outro', 'Концовка', 'manual'],
    ['preview', 'Анонс / повтор', 'off'],
    ['filler', 'Не по теме', 'off'],
    ['music_offtopic', 'Без музыки (в клипах)', 'off'],
    ['poi_highlight', 'Главный момент', 'manual'],
  ];
  const MODES = [['auto', 'Пропускать'], ['manual', 'Предлагать'], ['off', 'Не трогать']];
  const label = (c) => (CATEGORIES.find((x) => x[0] === c) || [c, c])[1];

  settings.define({ id: 'sb.enabled', type: 'bool', group: 'SponsorBlock', title: 'SponsorBlock', summary: 'Пропуск спонсорских вставок и других отмеченных сегментов', default: true });
  settings.define({ id: 'sb.toast', type: 'bool', group: 'SponsorBlock', title: 'Уведомлять о пропуске', summary: 'Показывать, что и сколько секунд пропущено', default: true });
  for (const [cat, title, def] of CATEGORIES) {
    if (cat === 'poi_highlight') {
      settings.define({ id: `sb.cat.${cat}`, type: 'choice', group: 'SponsorBlock', title, summary: 'Показывать кнопку перехода к главному моменту', default: def, options: [['manual', 'Показывать'], ['off', 'Не показывать']] });
    } else {
      settings.define({ id: `sb.cat.${cat}`, type: 'choice', group: 'SponsorBlock', title, default: def, options: MODES });
    }
  }
  const mode = (cat) => settings.get(`sb.cat.${cat}`) || 'off';
  settings.define({ id: 'sb.timeline', type: 'bool', group: 'SponsorBlock', title: 'Отметки на шкале', default: true });
  const COLORS = {
    sponsor: '#00d400', selfpromo: '#f5b800', interaction: '#cc00ff', intro: '#00ffff',
    outro: '#0202ed', preview: '#008fd6', filler: '#7300ff', music_offtopic: '#ff9900',
    poi_highlight: '#ff1684',
  };

  function timelineSegments(duration) {
    if (!settings.get('sb.enabled') || !settings.get('sb.timeline') || !Number.isFinite(duration) || duration <= 0) return [];
    const out = [];
    for (const s of segments) {
      if (!COLORS[s.category] || mode(s.category) === 'off' || s.action === 'full') continue;
      if (s.action === 'poi') {
        const pt = Math.max(0, Math.min(duration, s.start));
        const left = Math.min(99.4, pt / duration * 100);
        out.push({ start: pt, end: pt, color: COLORS[s.category], category: s.category, left, width: 0.6, poi: true });
        continue;
      }
      const start = Math.max(0, s.start);
      const end = Math.min(duration, s.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      out.push({ start, end, color: COLORS[s.category], category: s.category, left: start / duration * 100, width: (end - start) / duration * 100 });
    }
    return out;
  }

  // Paint solid color fragments in a fixed overlay host mounted on document.body (outside
  // YouTube's Incremental DOM trees) so chapter focus transitions, current-chapter rendering,
  // and player bar updates never strip or misalign them.
  let sbHost = null, lastPaintSig = '', paintQueued = false;
  function ensureSbHost() {
    if (sbHost && sbHost.parentNode) return sbHost;
    if (typeof document === 'undefined' || !document.body) return null;
    sbHost = document.createElement('div');
    sbHost.id = 'votv-sb-host';
    if (sbHost.setAttribute) sbHost.setAttribute('aria-hidden', 'true');
    sbHost.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1000;overflow:hidden';
    document.body.appendChild(sbHost);
    return sbHost;
  }

  function isElementVisible(el) {
    if (!el || el.isConnected === false) return false;
    const csFn = typeof getComputedStyle === 'function' ? getComputedStyle : null;
    for (let cur = el; cur && (!document || cur !== document.body); cur = cur.parentNode) {
      const inst = cur.__instance;
      if (inst && inst.props && inst.props.isHidden) return false;
      if (cur.style && (cur.style.display === 'none' || cur.style.visibility === 'hidden')) return false;
      if (csFn) {
        const s = csFn(cur);
        if (s && (s.display === 'none' || s.visibility === 'hidden' || (s.opacity !== undefined && s.opacity !== '' && parseFloat(s.opacity) <= 0.05))) return false;
      }
    }
    return true;
  }

  function buildChapterBoxes(bar, marks, v) {
    if (!isElementVisible(bar)) return null;
    const chapters = [...bar.children].filter((e) => (e.getAttribute('idomkey') || '').startsWith('chapter-'));
    if (!chapters.length) return null;
    const mm = (bar.closest && bar.closest('ytlr-multi-markers-player-bar-renderer')) || bar.parentNode || bar;
    const barRect = bar.getBoundingClientRect ? bar.getBoundingClientRect() : null;
    const rects = chapters.map((e) => (e.getBoundingClientRect ? e.getBoundingClientRect() : { width: 0, height: 0 }));

    const inst = mm && mm.__instance;
    const chData = inst && inst.props && inst.props.data && Array.isArray(inst.props.data.chapters) ? inst.props.data.chapters : null;
    const indexed = chData && chapters.every((e) => {
      const idx = parseInt((e.getAttribute('idomkey') || '').slice(8), 10);
      const ch = Number.isInteger(idx) && chData[idx];
      return ch && Number.isFinite(ch.start) && (Number.isFinite(ch.end) || (v && Number.isFinite(v.duration)));
    });

    const hasGapCoords = barRect && barRect.width > 0 && rects.some((r) => typeof r.left === 'number' && typeof barRect.left === 'number' && r.left > barRect.left);
    const totalW = hasGapCoords ? barRect.width : rects.reduce((a, r) => a + (r.width || 0), 0);
    if (!indexed && !totalW) return null;

    const ovLeft = (barRect && typeof barRect.left === 'number') ? barRect.left : 0;
    const ovTop = (barRect && typeof barRect.top === 'number') ? barRect.top : 0;
    const ovWidth = (barRect && barRect.width) || totalW;
    const ovHeight = (barRect && barRect.height) || Math.max(...rects.map((r) => r.height || 0), 0);
    if (ovWidth <= 0 || ovHeight <= 0) return null;

    const boxes = [];
    let accLeft = 0;
    for (let i = 0; i < chapters.length; i++) {
      const chEl = chapters[i];
      const r = rects[i];
      const w = r.width || 0;
      const h = r.height || ovHeight;
      const cLeft = (barRect && typeof r.left === 'number' && typeof barRect.left === 'number') ? (r.left - barRect.left) : accLeft;
      const cTop = (barRect && typeof r.top === 'number' && typeof barRect.top === 'number') ? (r.top - barRect.top) : 0;
      const offsetBefore = accLeft;
      accLeft += w;
      if (w <= 0 || h <= 0) continue;

      let local = [];
      if (indexed) {
        const idx = parseInt((chEl.getAttribute('idomkey') || '').slice(8), 10);
        const ch = chData[idx];
        const chStart = ch.start;
        const chEnd = Number.isFinite(ch.end) ? ch.end : v.duration;
        const chDur = chEnd - chStart;
        if (chDur > 0) {
          for (const s of marks) {
            if (s.poi) {
              if (s.start < chStart || s.start > chEnd) continue;
              const l = Math.max(0, Math.min(99.2, (s.start - chStart) / chDur * 100));
              local.push({ left: l, right: Math.min(100, l + 0.8), color: s.color, poi: true });
            } else if (s.start < chEnd && s.end > chStart) {
              const l = Math.max(0, (s.start - chStart) / chDur * 100);
              const rPct = Math.min(100, (s.end - chStart) / chDur * 100);
              if (rPct > l) local.push({ left: l, right: rPct, color: s.color, poi: false });
            }
          }
        }
      } else {
        const pctLeft = (hasGapCoords ? cLeft : offsetBefore) / totalW * 100;
        const pctWidth = w / totalW * 100;
        local = marks.filter((s) => s.left < pctLeft + pctWidth && s.left + s.width > pctLeft).map((s) => ({
          left: Math.max(0, (s.left - pctLeft) / pctWidth * 100),
          right: Math.min(100, (s.left + s.width - pctLeft) / pctWidth * 100),
          color: s.color,
          poi: !!s.poi,
        }));
      }
      if (!local.length) continue;
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(chEl) : null;
      const radius = (cs && cs.borderRadius) || '';
      boxes.push({ left: cLeft, top: cTop, width: w, height: h, radius, local });
    }
    return boxes.length ? { left: ovLeft, top: ovTop, width: ovWidth, height: ovHeight, boxes } : null;
  }

  function buildSliderOverlay(slider, marks) {
    if (!isElementVisible(slider)) return null;
    const cueLayer = [...slider.children].find((e) => e.getAttribute && e.getAttribute('idomkey') === 'cue-ranges');
    let rect = null;
    if (cueLayer && cueLayer.getBoundingClientRect) {
      const cr = cueLayer.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) rect = cr;
    }
    if (!rect) {
      const tracks = [...slider.children].filter((e) => /scaleX\(/.test((e.style && e.style.transform) || ''));
      const sr = slider.getBoundingClientRect ? slider.getBoundingClientRect() : null;
      const tr = tracks[0] && tracks[0].getBoundingClientRect ? tracks[0].getBoundingClientRect() : null;
      if (!sr || !tr || sr.width <= 0 || tr.height <= 0) return null;
      rect = { left: sr.left || 0, top: tr.top || 0, width: sr.width, height: tr.height };
    }
    const local = marks.map((s) => ({
      left: Math.max(0, s.left),
      right: Math.min(100, s.left + s.width),
      color: s.color,
      poi: !!s.poi,
    })).filter((s) => s.right > s.left);
    if (!local.length) return null;
    return {
      left: typeof rect.left === 'number' ? rect.left : 0,
      top: typeof rect.top === 'number' ? rect.top : 0,
      width: rect.width,
      height: rect.height,
      boxes: [{ left: 0, top: 0, width: rect.width, height: rect.height, radius: '', local }],
    };
  }

  function paintTimeline() {
    const v = player.video();
    const marks = timelineSegments(v && player.videoId() === current ? v.duration : NaN);
    const overlays = [];
    if (marks.length) {
      for (const bar of document.querySelectorAll('ytlr-multi-markers-player-bar-renderer > [idomkey="progress-bar"]')) {
        const spec = buildChapterBoxes(bar, marks, v);
        if (spec) overlays.push(spec);
      }
      for (const slider of document.querySelectorAll('ytlr-progress-bar [idomkey="slider"]')) {
        const spec = buildSliderOverlay(slider, marks);
        if (spec) overlays.push(spec);
      }
    }
    if (!overlays.length) {
      if (sbHost) { sbHost.remove(); sbHost = null; }
      lastPaintSig = '';
      return;
    }
    const hostEl = ensureSbHost();
    if (!hostEl) return;
    const signature = JSON.stringify(overlays);
    if (signature === lastPaintSig && hostEl.children.length === overlays.length) return;
    lastPaintSig = signature;
    if (hostEl.replaceChildren) hostEl.replaceChildren();
    else while (hostEl.children.length) hostEl.children[0].remove();
    for (const ov of overlays) {
      const layer = document.createElement('div');
      layer.className = 'votv-sb-overlay';
      layer.style.cssText = `position:fixed;pointer-events:none;overflow:visible;left:${ov.left}px;top:${ov.top}px;width:${ov.width}px;height:${ov.height}px`;
      for (const box of ov.boxes) {
        const chBox = document.createElement('div');
        chBox.className = 'votv-sb-chapter';
        const rad = box.radius ? `;border-radius:${box.radius}` : '';
        chBox.style.cssText = `position:absolute;pointer-events:none;overflow:hidden;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px${rad}`;
        for (const s of box.local) {
          const fragment = document.createElement('div');
          fragment.className = 'votv-sb-fragment';
          const minW = s.poi ? ';min-width:4px' : '';
          fragment.style.cssText = `position:absolute;pointer-events:none;top:0px;height:100%;left:${s.left}%;width:${s.right - s.left}%${minW};background-color:${s.color}`;
          chBox.appendChild(fragment);
        }
        layer.appendChild(chBox);
      }
      hostEl.appendChild(layer);
    }
  }
  function schedulePaint() {
    if (paintQueued) return;
    if (typeof requestAnimationFrame === 'function') {
      paintQueued = true;
      requestAnimationFrame(() => { paintQueued = false; paintTimeline(); });
    } else {
      paintTimeline();
    }
  }
  setInterval(paintTimeline, 250);
  if (typeof MutationObserver === 'function') votv.whenBody(() => {
    const isSbHost = (t) => {
      for (let cur = t; cur; cur = cur.parentNode) {
        if (cur.id === 'votv-sb-host' || (typeof cur.className === 'string' && cur.className.includes('votv-sb-overlay'))) return true;
      }
      return false;
    };
    const observer = new MutationObserver((records) => {
      if (records.some((r) => {
        const t = r.target;
        if (!t || !t.closest || isSbHost(t)) return false;
        return t.closest('ytlr-progress-bar, ytlr-multi-markers-player-bar-renderer, ytlr-player-controls');
      })) schedulePaint();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });
  });

  // ---- interactive skip / unskip prompt -----------------------------------------------
  let promptEl = null, promptDot = null, promptTitle = null, promptKey = null;
  let promptState = null; // { kind: 'manual', seg } | { kind: 'undo', skip, expiresAt }
  let lastSkip = null;    // { uuid, category, from, to, at }

  function ensurePrompt() {
    if (promptEl || typeof document === 'undefined' || !document.body) return promptEl;
    promptEl = document.createElement('div');
    promptEl.id = 'votv-sb-prompt';
    promptEl.style.cssText = 'position:fixed;right:48px;bottom:140px;z-index:2147483550;pointer-events:none;display:none;' +
      'align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:rgba(20,20,20,.94);' +
      'border:1px solid rgba(255,255,255,.12);color:#f1f1f1;font-family:"YouTube Sans",Roboto,Arial,sans-serif;font-size:22px;font-weight:500';
    promptDot = document.createElement('span');
    promptDot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex:none;background:#00d400';
    promptTitle = document.createElement('span');
    promptKey = document.createElement('span');
    promptKey.style.cssText = 'padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.8);font-size:18px;font-weight:500';
    promptEl.appendChild(promptDot);
    promptEl.appendChild(promptTitle);
    promptEl.appendChild(promptKey);
    document.body.appendChild(promptEl);
    return promptEl;
  }

  function renderPrompt() {
    if (!promptState) {
      if (promptEl) promptEl.style.display = 'none';
      return;
    }
    const el = ensurePrompt();
    if (!el) return;
    const cat = promptState.kind === 'manual' ? promptState.seg.category : promptState.skip.category;
    promptDot.style.background = COLORS[cat] || '#f1f1f1';
    if (promptState.kind === 'manual') {
      promptTitle.textContent = `${label(cat)} · Пропустить`;
      promptKey.textContent = 'OK';
    } else {
      const saved = Math.max(1, Math.round(promptState.skip.to - promptState.skip.from));
      promptTitle.textContent = `Пропущено: ${label(cat)} (${saved} с)`;
      promptKey.textContent = 'OK — отменить';
    }
    el.style.display = 'flex';
  }

  function clearPrompt() {
    promptState = null;
    renderPrompt();
  }

  function showManualPrompt(seg) {
    promptState = { kind: 'manual', seg };
    renderPrompt();
  }

  function showUndoPrompt(skipInfo) {
    promptState = { kind: 'undo', skip: skipInfo, expiresAt: Date.now() + 5000 };
    renderPrompt();
  }

  // ---- data ---------------------------------------------------------------------------
  const cache = new Map(); // videoId -> segments[]
  let segments = [], current = '', loading = false;
  const stats = votv.storage.get('sb.stats', { count: 0, seconds: 0 }) || { count: 0, seconds: 0 };

  async function sha256Prefix(text) {
    if (!(window.crypto && crypto.subtle)) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf).slice(0, 2), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function fetchSegments(videoId) {
    const cats = encodeURIComponent(JSON.stringify(CATEGORIES.map((c) => c[0])));
    const types = encodeURIComponent(JSON.stringify(['skip', 'mute', 'poi', 'full']));
    const prefix = await sha256Prefix(videoId).catch(() => null);
    const url = prefix ? `${API}/${prefix}?categories=${cats}&actionTypes=${types}`
      : `${API}?videoID=${videoId}&categories=${cats}&actionTypes=${types}`;
    const r = await votv.request({ url, timeout: 15000, headers: { Accept: 'application/json' } });
    if (r.status === 404) return [];
    if (r.status !== 200) throw new Error(`SponsorBlock ${r.status} ${r.error || ''}`);
    const data = JSON.parse(r.body);
    const list = prefix ? ((data.find((v) => v.videoID === videoId) || {}).segments || []) : data;
    return list
      .filter((s) => Array.isArray(s.segment) && s.segment.length === 2)
      .map((s) => ({ category: s.category, action: s.actionType || 'skip', start: +s.segment[0], end: +s.segment[1], uuid: s.UUID }))
      .sort((a, b) => a.start - b.start);
  }

  function notifyFullVideo() {
    const full = segments.find((s) => s.action === 'full' && mode(s.category) !== 'off');
    if (full && settings.get('sb.toast')) votv.toast(`SponsorBlock: всё видео — ${label(full.category)}`, 4000);
  }

  async function load(videoId) {
    segments = [];
    done.clear();
    dismissedPrompt.clear();
    lastSkip = null;
    clearPrompt();
    current = videoId;
    if (!videoId || !settings.get('sb.enabled')) return;
    if (cache.has(videoId)) { segments = cache.get(videoId); notifyFullVideo(); return; }
    loading = true;
    try {
      const segs = await fetchSegments(videoId);
      cache.set(videoId, segs);
      if (cache.size > 20) cache.delete(cache.keys().next().value);
      if (current === videoId) {
        segments = segs;
        if (segs.length) votv.log(`sponsorblock: ${segs.length} segments for ${videoId}`);
        notifyFullVideo();
      }
    } catch (e) {
      votv.warn('sponsorblock: load failed', e);
    } finally {
      loading = false;
      ui.panel.refresh();
    }
  }
  player.onVideoChange(load);
  settings.onChange('sb.enabled', (on) => { if (on) load(player.videoId()); else { segments = []; done.clear(); dismissedPrompt.clear(); clearPrompt(); } });

  // ---- skipping -----------------------------------------------------------------------
  const done = new Set(); // segments already skipped/sought-into/offered for this video (uuid)
  const dismissedPrompt = new Set();
  let muted = null, lastTime = 0, selfSeekUntil = 0, userSeeking = false, attachedVideo = null;
  const fmt = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };

  function skip(v, seg, manual) {
    const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
    const from = v.currentTime;
    let to = Math.min(seg.end, dur - 0.25);
    if (to <= from) return;
    const uuids = [seg.uuid];
    done.add(seg.uuid);
    dismissedPrompt.delete(seg.uuid);
    if (!manual) {
      let extended = true;
      while (extended) {
        extended = false;
        for (const next of segments) {
          if (next.action === 'mute' || next.action === 'poi' || next.action === 'full') continue;
          if (mode(next.category) !== 'auto' || done.has(next.uuid)) continue;
          if (next.start <= to + 0.5 && next.end > to) {
            const nextTo = Math.min(next.end, dur - 0.25);
            if (nextTo > to) to = nextTo;
            done.add(next.uuid);
            uuids.push(next.uuid);
            extended = true;
          }
        }
      }
    }
    const saved = to - from;
    selfSeekUntil = Date.now() + 800;
    v.currentTime = to;
    lastTime = to;
    lastSkip = { uuid: seg.uuid, uuids, seg, category: seg.category, from, to, at: Date.now() };
    stats.count += 1;
    stats.seconds += saved;
    votv.storage.set('sb.stats', stats);
    if (manual) clearPrompt();
    else showUndoPrompt(lastSkip);
    if (settings.get('sb.toast')) votv.toast(`${manual ? 'Пропущено' : 'SponsorBlock'}: ${label(seg.category)} · ${Math.round(saved)} с`, 2500);
    votv.log(`sponsorblock: skipped ${seg.category} ${fmt(seg.start)}-${fmt(to)}`);
    ui.panel.refresh();
  }

  function undoSkip() {
    if (!lastSkip) return false;
    const v = player.video();
    if (!v) return false;
    const info = lastSkip;
    selfSeekUntil = Date.now() + 800;
    for (const u of (info.uuids || [info.uuid])) done.add(u);
    v.currentTime = info.from;
    lastTime = info.from;
    lastSkip = null;
    if (info.seg) {
      dismissedPrompt.delete(info.seg.uuid);
      showManualPrompt(info.seg);
    } else {
      clearPrompt();
    }
    votv.toast(`Отменено: ${label(info.category)}`, 2500);
    votv.log(`sponsorblock: unskipped ${info.category} back to ${fmt(info.from)}`);
    ui.panel.refresh();
    return true;
  }

  function inSegment(t) {
    return segments.filter((s) => s.action !== 'poi' && s.action !== 'full' && t >= s.start && t < s.end - 0.3);
  }

  function markSeekSegments(v) {
    if (!settings.get('sb.enabled') || !segments.length) return;
    const t = v.currentTime;
    for (const seg of inSegment(t)) {
      if (seg.action === 'mute' || mode(seg.category) !== 'auto') continue;
      if (!done.has(seg.uuid)) {
        done.add(seg.uuid);
        dismissedPrompt.delete(seg.uuid);
      }
    }
  }

  function attachVideoListeners(v) {
    if (!v || v === attachedVideo || typeof v.addEventListener !== 'function') return;
    attachedVideo = v;
    v.addEventListener('seeking', () => {
      if (Date.now() > selfSeekUntil) userSeeking = true;
    });
    v.addEventListener('seeked', () => {
      if (!userSeeking) return;
      userSeeking = false;
      markSeekSegments(v);
    });
  }

  function tick() {
    if (promptState && promptState.kind === 'undo' && Date.now() >= promptState.expiresAt) clearPrompt();
    if (!settings.get('sb.enabled') || !segments.length) return;
    const v = player.video();
    if (!v || player.videoId() !== current) return;
    attachVideoListeners(v);
    const t = v.currentTime;
    const isSelfSeek = Date.now() <= selfSeekUntil;
    if (v.seeking && !isSelfSeek) {
      userSeeking = true;
      lastTime = t;
      return;
    }
    if (userSeeking && !v.seeking) {
      userSeeking = false;
      markSeekSegments(v);
    } else if (!isSelfSeek && lastTime > 0 && t + 1.5 < lastTime) {
      markSeekSegments(v);
    }
    lastTime = t;
    const active = inSegment(t);
    for (const u of dismissedPrompt) {
      if (!active.some((s) => s.uuid === u)) dismissedPrompt.delete(u);
    }
    if (promptState && promptState.kind === 'manual' && !active.some((s) => s.uuid === promptState.seg.uuid)) {
      clearPrompt();
    }
    let shouldMute = false;
    let manualCandidate = null;
    for (const seg of active) {
      const m = mode(seg.category);
      if (m === 'off') continue;
      if (seg.action === 'mute') { if (m === 'auto') shouldMute = true; continue; }
      if (done.has(seg.uuid)) {
        if (!manualCandidate && !dismissedPrompt.has(seg.uuid)) manualCandidate = seg;
        continue;
      }
      if (m === 'auto' && !v.paused) { skip(v, seg, false); return; }
      if (m === 'manual') {
        done.add(seg.uuid);
        dismissedPrompt.delete(seg.uuid);
        showManualPrompt(seg);
        votv.toast(`${label(seg.category)} до ${fmt(seg.end)} — пропустить можно в меню VOTV`, 4000);
      }
    }
    if (manualCandidate && (!promptState || promptState.kind === 'undo')) showManualPrompt(manualCandidate);
    if (shouldMute && muted === null) { muted = v.muted; v.muted = true; votv.log('sponsorblock: muted a segment'); }
    if (!shouldMute && muted !== null) { v.muted = muted; muted = null; }
  }
  setInterval(tick, 200);
  player.onVideoChange(() => { if (muted !== null) { const v = player.video(); if (v) v.muted = muted; muted = null; } lastTime = 0; lastSkip = null; userSeeking = false; attachedVideo = null; dismissedPrompt.clear(); clearPrompt(); });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', (e) => {
      if (!promptState || (ui.panel && ui.panel.isOpen && ui.panel.isOpen())) return;
      const k = e.keyCode;
      if (k === 27) {
        if (promptState.kind === 'manual' && promptState.seg) dismissedPrompt.add(promptState.seg.uuid);
        clearPrompt();
        return;
      }
      if ((k === 13 || k === 23) && !document.querySelector('.zylon-focus')) {
        if (promptState.kind === 'manual') {
          const v = player.video();
          if (v) { skip(v, promptState.seg, true); e.preventDefault(); e.stopImmediatePropagation(); }
        } else if (promptState.kind === 'undo') {
          if (undoSkip()) { e.preventDefault(); e.stopImmediatePropagation(); }
        }
      }
    }, true);
  }

  // ---- panel --------------------------------------------------------------------------
  ui.panel.section({
    id: 'sb', order: 30, title: 'SponsorBlock',
    rows: () => {
      const on = settings.get('sb.enabled');
      const rows = [{
        kind: 'toggle', id: 'on', label: 'Пропускать сегменты',
        hint: stats.count ? `Пропущено ${stats.count}, сэкономлено ${fmt(stats.seconds)}` : 'База SponsorBlock',
        value: on, onChange: (v) => settings.set('sb.enabled', v),
      }];
      rows.push({ kind: 'toggle', id: 'timeline', label: 'Отметки на шкале', hint: 'Зелёный — спонсор · жёлтый — самореклама', value: settings.get('sb.timeline'), onChange: (v) => settings.set('sb.timeline', v) });
      if (!on) return rows;
      if (lastSkip) {
        rows.push({ kind: 'button', id: 'undo', label: `Отменить пропуск: ${label(lastSkip.category)}`, value: `к ${fmt(lastSkip.from)}`, onPress: undoSkip });
      }
      const fullSeg = segments.find((s) => s.action === 'full' && mode(s.category) !== 'off');
      if (fullSeg) {
        rows.push({ kind: 'info', id: 'full', label: 'Всё видео отмечено', value: label(fullSeg.category) });
      }
      const v = player.video();
      const t = v ? v.currentTime : 0;
      const here = inSegment(t).find((s) => mode(s.category) !== 'off' && s.action !== 'mute');
      if (here) rows.push({ kind: 'button', id: 'skipnow', label: `Пропустить: ${label(here.category)}`, value: `до ${fmt(here.end)}`, onPress: () => { const vv = player.video(); if (vv) skip(vv, here, true); } });
      const poi = segments.find((s) => s.action === 'poi' && mode('poi_highlight') !== 'off');
      if (poi) rows.push({ kind: 'button', id: 'poi', label: 'К главному моменту', value: fmt(poi.start), onPress: () => { const vv = player.video(); if (vv) vv.currentTime = poi.start; } });
      const list = segments.filter((s) => s.action !== 'poi' && s.action !== 'full');
      rows.push({
        kind: 'group', id: 'segs', label: 'Сегменты этого видео',
        value: loading ? 'загрузка…' : (list.length ? String(list.length) : 'нет'),
        rows: list.map((s, i) => ({
          kind: 'button', id: `s${i}`, label: label(s.category),
          hint: `${fmt(s.start)} – ${fmt(s.end)} · ${({ auto: 'пропускается', manual: 'предлагается', off: 'не трогаем' })[mode(s.category)]}${s.action === 'mute' ? ' · без звука' : ''}`,
          value: 'перейти в конец', onPress: () => { const vv = player.video(); if (vv) skip(vv, s, true); },
        })),
      });
      rows.push({
        kind: 'group', id: 'cats', label: 'Категории', hint: 'Что пропускать автоматически',
        rows: CATEGORIES.filter((c) => c[0] !== 'poi_highlight').map(([cat, title]) => ({
          kind: 'select', id: cat, label: title, value: () => mode(cat), options: MODES, onChange: (m) => settings.set(`sb.cat.${cat}`, m),
        })),
      });
      return rows;
    },
  });

  return { fetchSegments, sha256Prefix, segments: () => segments, stats, tick, load, timelineSegments, paintTimeline, undoSkip, prompt: () => promptState };
});
