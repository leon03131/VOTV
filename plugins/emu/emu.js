/* Dev only (emulator): the Android TV emulator has no VP9 decoder, so youtube.com/tv shows
 * "not supported". Claim VP9 support so the UI loads for UI work. Videos may not play.
 * Never shipped in the APK bundle (devOnly in plugins.json). */
__votv.define('emu', (votv) => {
  if (!/AOSP TV on x86|Android SDK built for/.test(navigator.userAgent)) return {};
  if (window.__votvEmu) return {};
  window.__votvEmu = true;
  const vp9 = (t) => /vp9|vp09/i.test(String(t));

  const MS = window.MediaSource;
  if (MS) {
    const orig = MS.isTypeSupported.bind(MS);
    MS.isTypeSupported = (type) => orig(type) || vp9(type);
  }
  const canPlay = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) {
    return vp9(type) ? 'probably' : canPlay.call(this, type);
  };
  if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
    const mc = navigator.mediaCapabilities, info = mc.decodingInfo.bind(mc);
    mc.decodingInfo = async (cfg) => {
      const r = await info(cfg);
      return cfg && cfg.video && vp9(cfg.video.contentType) ? { ...r, supported: true, smooth: true, powerEfficient: true } : r;
    };
  }
  votv.warn('emu: VP9 support spoofed (emulator only)');
  return {};
});
