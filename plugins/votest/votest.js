/* Dev only: end-to-end check of the voice-over on the device. Starts the translation when a
 * video plays, then for ~40 s logs how far the native audio is from the video. Logs
 * "votest PASS ..." when the audio played in sync for 10 s, "votest FAIL ..." otherwise. */
__votv.define('votest', (votv) => {
  const vot = votv.plugins.vot;
  if (!vot || !vot.start) return {};
  let tested = '';
  setInterval(() => {
    const v = votv.player.video(), id = votv.player.videoId();
    if (!v || !id || tested === id || v.paused || v.readyState < 3) return;
    tested = id;
    votv.log(`votest: starting translation of ${id}`);
    vot.start();
    const started = Date.now();
    let good = 0;
    const timer = setInterval(() => {
      const s = vot.state();
      let a = {};
      try { a = JSON.parse(VotHost.audioState()); } catch (e) { /* */ }
      const drift = a.state === 'playing' ? (a.position - v.currentTime) : NaN;
      if (Math.abs(drift) < 0.12) good++; else good = 0;
      votv.log(`votest: phase=${s.phase} audio=${a.state} drift=${Number.isNaN(drift) ? '-' : drift.toFixed(2)} msg=${s.message}`);
      if (good >= 5 || s.phase === 'error' || Date.now() - started > 120000) {
        clearInterval(timer);
        votv.log(`votest ${good >= 5 ? 'PASS' : 'FAIL'}: phase=${s.phase} audio=${a.state} ${a.error || ''} proxy=${s.proxy}`);
        if (good >= 5) {
          votv.ui.panel.open();
          const list = document.querySelector('#votv-panel .vp-list');
          let mutations = 0;
          const observer = new MutationObserver((records) => { mutations += records.length; });
          observer.observe(list, { childList: true, subtree: true, attributes: true, characterData: true });
          setTimeout(() => {
            observer.disconnect();
            votv.log(`votest panel: ${mutations === 0 ? 'PASS' : 'CHECK'} mutations=${mutations} over 5s`);
          }, 5000);
        }
      }
    }, 2000);
  }, 1000);
  return {};
});
