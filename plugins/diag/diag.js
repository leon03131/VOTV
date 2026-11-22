/* Diagnostics: what this Cobalt build can do. Logs one JSON report (logcat tag VOTV)
 * and keeps the last one in storage ("diag.report"). */
__votv.define('diag', (votv) => {
  const mse = (type) => { try { return !!window.MediaSource && MediaSource.isTypeSupported(type); } catch (e) { return 'err'; } };

  // 0.2 s of silence as a WAV data URI: tests <audio> without any network.
  function silentWav() {
    const rate = 8000, n = rate / 5, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    let bin = ''; new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  async function audioElement() {
    const a = document.createElement('audio');
    const out = { mp3: a.canPlayType('audio/mpeg'), aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'), wav: a.canPlayType('audio/wav') };
    try {
      a.src = silentWav();
      a.volume = 0;
      await withTimeout(a.play(), 3000);
      out.play = 'ok';
    } catch (e) { out.play = String(e && e.name || e); }
    return out;
  }

  async function audioContext() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return { present: false };
    try {
      const ctx = new C();
      const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
      const o = ctx.createOscillator(); o.connect(g); o.start();
      try { await withTimeout(ctx.resume(), 2000); } catch (e) { /* ignore */ }
      const t0 = ctx.currentTime;
      await new Promise((r) => setTimeout(r, 400));
      const res = { present: true, state: ctx.state, rate: ctx.sampleRate, advancing: ctx.currentTime > t0 };
      o.stop(); ctx.close();
      return res;
    } catch (e) { return { present: true, error: String(e) }; }
  }

  async function widevine() {
    if (!navigator.requestMediaKeySystemAccess) return 'no EME';
    try {
      const acc = await withTimeout(navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
        initDataTypes: ['cenc'],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.4d401e"' }],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
      }]), 3000);
      return 'ok ' + acc.keySystem;
    } catch (e) { return String(e && e.name || e); }
  }

  async function bridgeHttp() {
    const t = Date.now();
    const r = await votv.request({ url: 'https://www.gstatic.com/generate_204', timeout: 20000 });
    return { status: r.status, ms: Date.now() - t, error: r.error };
  }

  // Can WebAudio decode mp3 (the format of Yandex voice-over)? Binary comes through the host as base64.
  async function webAudioMp3() {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c8/Example.ogg/Example.ogg.mp3';
    const t = Date.now();
    const r = await votv.request({ url, responseType: 'base64', timeout: 20000 });
    if (r.status !== 200 || !r.bodyBase64) return { status: r.status, error: r.error, headers: r.headers, b64len: (r.bodyBase64 || '').length };
    const bin = atob(r.bodyBase64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const C = window.AudioContext || window.webkitAudioContext;
    const ctx = new C();
    try {
      const buf = await withTimeout(ctx.decodeAudioData(bytes.buffer), 10000);
      return { ok: true, kb: Math.round(bytes.length / 1024), seconds: Math.round(buf.duration * 10) / 10, channels: buf.numberOfChannels, ms: Date.now() - t };
    } catch (e) {
      return { ok: false, kb: Math.round(bin.length / 1024), ctype: r.headers && r.headers['content-type'], error: String(e && e.name || e) };
    } finally { ctx.close(); }
  }

  async function run() {
    const report = {
      host: votv.info,
      ua: navigator.userAgent,
      url: location.href,
      screen: [screen.width, screen.height, window.devicePixelRatio],
      pageText: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 160),
      mse: {
        avc: mse('video/mp4; codecs="avc1.4d401e"'),
        avc1080: mse('video/mp4; codecs="avc1.640028"; width=1920; height=1080; framerate=30'),
        vp9: mse('video/webm; codecs="vp9"'),
        vp9_1080: mse('video/webm; codecs="vp9"; width=1920; height=1080; framerate=30'),
        av1: mse('video/mp4; codecs="av01.0.05M.08"'),
        opus: mse('audio/webm; codecs="opus"'),
        aac: mse('audio/mp4; codecs="mp4a.40.2"'),
      },
      eme: await widevine(),
      audioElement: await audioElement(),
      audioContext: await audioContext(),
      http: await bridgeHttp(),
      // Downloads a sample file from Wikimedia: dev mode only.
      webAudioMp3: votv.info.dev ? await webAudioMp3().catch((e) => ({ error: String(e) })) : 'skipped',
      webAudioWav: await (async () => {
        const C = window.AudioContext || window.webkitAudioContext, ctx = new C();
        try {
          const bin = atob(silentWav().split(',')[1]), b = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
          const buf = await withTimeout(ctx.decodeAudioData(b.buffer), 5000);
          return { ok: true, seconds: buf.duration };
        } catch (e) { return { ok: false, error: String(e && e.name || e) }; } finally { ctx.close(); }
      })(),
      h5vcc: typeof window.h5vcc,
    };
    votv.log('diag ' + JSON.stringify(report));
    votv.storage.set('diag.report', report);
    return report;
  }

  votv.whenBody(() => {
    if (!(votv.settings && votv.settings.get('votv.startToast') === false)) {
      votv.toast(`VOTV ${votv.info.host || ''} подключён${votv.info.dev ? ' · dev' : ''}`);
    }
    // Full report: always in dev mode, otherwise once per app version (it makes network requests).
    const last = votv.storage.get('diag.version');
    if (!votv.info.dev && last === votv.info.app) return;
    // Let the page settle first (the "unsupported" screen appears after startup checks).
    setTimeout(() => {
      run().then(() => votv.storage.set('diag.version', votv.info.app)).catch((e) => votv.error('diag failed', e));
    }, 6000);
  });

  return { run };
});
