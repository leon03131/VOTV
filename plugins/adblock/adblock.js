/* Ad filtering: removes ads from YouTube's API responses before the app sees them.
 * - player responses (/youtubei/v1/player): adPlacements, playerAds, adSlots, adBreakHeartbeatParams
 * - feeds (/browse, /next, /search): items that are ad renderers (adSlotRenderer, promoted*)
 * Works through votv.hooks.json (JSON.parse / Response.json). Note: YouTube shows no ads in some
 * regions (e.g. Russia), so there may be nothing to remove. */
__votv.define('adblock', (votv) => {
  const { settings, ui } = votv;

  const PLAYER_KEYS = ['adPlacements', 'playerAds', 'adSlots'];
  const PLAYER_SILENT = ['adBreakHeartbeatParams']; // removed but not an ad by itself: not counted
  const AD_RENDERER = /^(adSlotRenderer|adSlotAndLayoutRenderer|promotedVideoRenderer|promotedSparklesWebRenderer|promotedSparklesTextSearchRenderer|searchPyvRenderer|bannerPromoRenderer|statementBannerRenderer|compactPromotedVideoRenderer|tvMastheadAdRenderer)$/;

  settings.define({
    id: 'ads.enabled', type: 'bool', group: 'Реклама', title: 'Убирать рекламу',
    summary: 'Вырезать рекламные вставки и карточки из ответов YouTube', default: true,
  });

  const stats = { player: 0, items: 0, total: votv.storage.get('ads.total', 0) || 0 };
  let saveTimer = 0;
  const count = (n) => {
    stats.total += n;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => votv.storage.set('ads.total', stats.total), 2000);
  };

  /** Remove ad fields of a player response. Returns how many were removed. */
  function cleanPlayer(p) {
    let n = 0;
    for (const k of PLAYER_SILENT) delete p[k];
    for (const k of PLAYER_KEYS) {
      if (p[k] === undefined) continue;
      if (Array.isArray(p[k]) && p[k].length) n += p[k].length;
      else if (!Array.isArray(p[k])) n += 1;
      delete p[k];
    }
    return n;
  }

  /** Remove ad items from arrays anywhere in a feed response (bounded walk). */
  function cleanFeed(o, depth) {
    if (!o || typeof o !== 'object' || depth > 40) return 0;
    let n = 0;
    if (Array.isArray(o)) {
      for (let i = o.length - 1; i >= 0; i--) {
        const it = o[i];
        const key = it && typeof it === 'object' && !Array.isArray(it) ? Object.keys(it)[0] : null;
        const inner = key && it[key];
        const isAd = (key && AD_RENDERER.test(key)) ||
          // wrapper items whose content is an ad (richItemRenderer{content:{adSlotRenderer}} etc.)
          (inner && typeof inner === 'object' && inner.content && typeof inner.content === 'object' && AD_RENDERER.test(Object.keys(inner.content)[0] || ''));
        if (isAd) { o.splice(i, 1); n++; } else n += cleanFeed(it, depth + 1);
      }
      return n;
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && typeof v === 'object') n += cleanFeed(v, depth + 1);
    }
    return n;
  }

  function clean(o) {
    if (!settings.get('ads.enabled')) return;
    let n = 0;
    if (o.playabilityStatus || o.streamingData || o.videoDetails) n += cleanPlayer(o);
    if (o.playerResponse && typeof o.playerResponse === 'object') n += cleanPlayer(o.playerResponse);
    if (n) { stats.player += n; count(n); votv.log(`adblock: removed ${n} ad entries from a player response`); }
    if (o.responseContext && (o.contents || o.onResponseReceivedActions || o.onResponseReceivedEndpoints || o.continuationContents)) {
      const m = cleanFeed(o, 0);
      if (m) { stats.items += m; count(m); votv.log(`adblock: removed ${m} ad items from a feed`); }
    }
  }
  votv.hooks.json(clean);

  ui.panel.section({
    id: 'ads', order: 40, title: 'Реклама',
    rows: () => [
      { kind: 'toggle', id: 'on', label: 'Убирать рекламу', hint: stats.total ? `Убрано за всё время: ${stats.total}` : 'Рекламы пока не встречалось', value: () => settings.get('ads.enabled'), onChange: (v) => settings.set('ads.enabled', v) },
    ],
  });

  return { clean, cleanPlayer, cleanFeed, stats };
});
