/* The VOTV section and player button: app-level settings, a quick menu in the player,
 * update checks, and an "about" page. Feature plugins (translation, SponsorBlock,
 * ad filtering) add their own settings and menu rows later. */
__votv.define('votv', (votv) => {
  const { settings, ui, player } = votv;

  settings.define({
    id: 'votv.button', type: 'bool', title: 'Кнопка VOTV в плеере',
    summary: 'Меню VOTV рядом с кнопкой субтитров', default: true,
  });
  settings.define({
    id: 'votv.startToast', type: 'bool', title: 'Уведомление при запуске',
    summary: 'Показывать «VOTV подключён» при открытии приложения', default: true,
  });
  settings.define({
    id: 'votv.about', type: 'info', title: 'О VOTV',
    heading: () => `VOTV ${votv.info.app || ''}`,
    actionLabel: 'Подробнее',
    action: { type: 'about' },
    description: () => {
      const i = votv.info;
      const plugins = Object.keys(votv.plugins).filter((p) => !['probe', 'emu'].includes(p));
      return `Версия ${i.app || '?'} · хост ${i.host || '?'} (API ${i.api || '?'})${i.dev ? ' · режим разработчика' : ''}. ` +
        `Плагины: ${plugins.join(', ') || '—'}. ` +
        'Перевод: voice-over-translation (ilyhalight) и vot.js (FOSWLY). Пропуск вставок: SponsorBlock. ' +
        'github.com/leon03131/votv';
    },
  });

  ui.onAction('about', () => {
    const d = settings.list().find((x) => x.id === 'votv.about');
    votv.toast(d.description(), 9000);
  });

  // ---- updates (GitHub Releases) ------------------------------------------------------
  const updateState = { checking: false, lastResult: null };
  function sourceLabel() {
    const src = votv.info.pluginSource;
    if (src === 'dev') return 'dev-сервер';
    if (src === 'downloaded') return 'обновление';
    return 'встроенные';
  }

  async function runUpdateCheck(silent = false) {
    if (updateState.checking || !votv.updates) return null;
    updateState.checking = true;
    panel.refresh();
    try {
      const r = await votv.updates.check();
      updateState.lastResult = r;
      votv.storage.set('votv.lastUpdateCheck', Date.now());
      if (r && r.updated) {
        votv.toast(`Плагины обновлены до ${r.pluginVersion} · перезагрузка…`, 3000);
        setTimeout(() => { try { window.VotHost && window.VotHost.reload(); } catch (e) {} }, 1500);
      } else if (r && r.apkUpdateAvailable) {
        votv.toast(`Доступен новый APK ${r.latestApkVersion} на GitHub Releases`, 6000);
      } else if (!silent) {
        votv.toast(r && r.ok ? 'Установлена актуальная версия VOTV' : `Обновление: ${(r && r.error) || 'ошибка'}`, 4000);
      }
      return r;
    } finally {
      updateState.checking = false;
      panel.refresh();
    }
  }

  settings.define({
    id: 'votv.update', type: 'info', title: 'Проверить обновления',
    heading: () => `Плагины: ${votv.info.pluginVersion || votv.info.app || '?'} (${sourceLabel()})`,
    actionLabel: 'Проверить',
    action: { type: 'checkUpdate' },
    description: () => 'Скачивает обновления плагинов и проверяет новые версии APK на GitHub Releases.',
  });
  ui.onAction('checkUpdate', () => { runUpdateCheck(false); });

  if (!votv.info.dev && votv.updates) {
    const lastCheck = votv.storage.get('votv.lastUpdateCheck', 0) || 0;
    if (Date.now() - lastCheck > 12 * 3600 * 1000) {
      setTimeout(() => { runUpdateCheck(true); }, 15000);
    }
  }

  // ---- current video title (from the player response) ---------------------------------
  const titles = new Map();
  votv.hooks.json((o) => {
    const d = o.videoDetails || (o.playerResponse && o.playerResponse.videoDetails);
    if (d && d.videoId && d.title) {
      titles.set(d.videoId, `${d.title}${d.author ? ' · ' + d.author : ''}`);
      if (titles.size > 30) titles.delete(titles.keys().next().value);
    }
  });

  // ---- the VOTV panel -----------------------------------------------------------------
  const panel = ui.panel;
  const runs = (x) => (!x ? '' : x.simpleText || (x.runs || []).map((r) => r.text).join(''));
  // Some videos get their player response inside the media stream (onesie), not as JSON:
  // read the title from ytlr-progress-bar state.videoData or ytlr-video-title-tray.
  function domTitle() {
    const bar = document.querySelector('ytlr-progress-bar');
    const vd = bar && bar.__instance && bar.__instance.state && bar.__instance.state.videoData;
    if (vd && vd.title) return `${vd.title}${vd.author ? ' · ' + vd.author : ''}`;
    const el = document.querySelector('ytlr-video-title-tray');
    if (!el) return '';
    const d = el.__instance && el.__instance.props && el.__instance.props.data;
    const t = d && (runs(d.title) || runs(d.videoTitle));
    const first = el.firstElementChild && el.firstElementChild.textContent;
    return (t || first || (el.innerText || el.textContent || '').split('\n')[0] || '').trim();
  }
  panel.subtitle = () => titles.get(player.videoId()) || domTitle() || 'Меню VOTV';

  panel.section({
    id: 'updates', order: 90, title: 'Обновления',
    rows: () => {
      const r = updateState.lastResult;
      const rows = [
        { kind: 'info', id: 'ver', label: 'Версия', hint: `APK ${votv.info.app || '?'} · источник: ${sourceLabel()}`, value: votv.info.pluginVersion || votv.info.app || '?' },
        { kind: 'button', id: 'check', label: updateState.checking ? 'Проверяем обновления…' : 'Проверить обновления',
          hint: r && r.apkUpdateAvailable ? `Доступен новый APK: ${r.latestApkVersion}` : 'GitHub Releases (leon03131/votv)',
          disabled: updateState.checking,
          onPress: () => runUpdateCheck(false) },
      ];
      if (votv.info.pluginSource === 'downloaded') {
        rows.push({ kind: 'button', id: 'rollback', label: 'Сбросить обновления плагинов', hint: 'Вернуться к версии из APK',
          onPress: () => { votv.updates.rollback(); votv.toast('Плагины сброшены · перезагрузка…', 2000); setTimeout(() => { try { window.VotHost && window.VotHost.reload(); } catch (e) {} }, 1000); } });
      }
      return rows;
    },
  });
  panel.section({
    id: 'about', order: 100, title: '',
    rows: () => [{ kind: 'info', id: 'more', label: 'Все настройки VOTV', hint: 'Настройки YouTube → раздел VOTV в конце списка' }],
  });

  ui.playerButton({
    id: 'menu',
    icon: 'TRANSLATE',
    label: () => 'VOTV',
    enabled: () => settings.get('votv.button'),
    onPress: () => panel.open(),
  });

  return {};
});
