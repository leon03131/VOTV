/* Dev only: end-to-end check of SponsorBlock auto-skip on the device. Once segments for the
 * playing video are loaded, seeks 1.5 s before the first auto-skipped segment and checks that
 * playback ends up past it. Logs "sbtest PASS ..." / "sbtest FAIL ...". */
__votv.define('sbtest', (votv) => {
  const sb = votv.plugins.sponsorblock;
  if (!sb) return {};
  let tested = '';
  setInterval(() => {
    const v = votv.player.video(), id = votv.player.videoId();
    if (!v || !id || tested === id || v.paused || v.readyState < 3) return;
    const seg = sb.segments().find((s) => s.action === 'skip' && votv.settings.get(`sb.cat.${s.category}`) === 'auto' && s.start > 3);
    if (!seg) return;
    tested = id;
    votv.log(`sbtest: seeking to ${(seg.start - 1.5).toFixed(1)} before ${seg.category} ${seg.start.toFixed(1)}-${seg.end.toFixed(1)}`);
    v.currentTime = seg.start - 1.5;
    // after a seek the TV buffers for a few seconds: poll up to 25 s
    const started = Date.now();
    const check = setInterval(() => {
      const t = v.currentTime, ok = t >= seg.end - 0.5;
      if (!ok && Date.now() - started < 25000) return;
      clearInterval(check);
      votv.log(`sbtest ${ok ? 'PASS' : 'FAIL'}: now at ${t.toFixed(1)}, segment ended ${seg.end.toFixed(1)}, ${((Date.now() - started) / 1000).toFixed(1)} s after the seek`);
    }, 250);
  }, 1000);
  return {};
});
