<p align="center">
  <a href="../../README.md">Русский</a> ·
  <strong>English</strong> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.hi.md">हिन्दी</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.pt.md">Português</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="../../branding/res/drawable-xhdpi/app_banner.png" width="420" alt="VOTV">
</p>

# VOTV

Patches and JavaScript plugins for official **YouTube for Android TV (8.02.300)**: Yandex voice-over translation, SponsorBlock, and ad removal.

[sadthers.dev](https://sadthers.dev) · [Plugin Releases](https://github.com/leon03131/votv/releases) · [CI Tests](https://github.com/leon03131/votv/actions/workflows/test.yml) · YouTube TV `8.02.300` · [GPL-3.0](../../LICENSE)

---

## Features

- **Yandex Voice-Over Translation (`@vot.js/core`)** — voice translation into Russian, English, or Kazakh. Uses a native Java-host `AudioPlayer` with smooth rate-sync, independent translation/original volume controls, VOT subtitles, and `PART_CONTENT` / `AUDIO_REQUESTED` stream handling, with automatic fallback from lively voices to standard voice and proxy.
- **SponsorBlock** — SHA-256 prefix lookup via the [SponsorBlock API](https://sponsor.ajay.app/). Segment markers render over both standard and chapter progress bars (resilient to Incremental DOM re-renders), with auto-skip, chained segments, manual skip prompt, and rewind handling.
- **Ad Removal** — strips ad slots from player responses and feed recommendations.
- **TV Remote UI** — slide-out VOTV player panel for quick toggles, languages, subtitles, and volume, plus inline VOTV/SponsorBlock sections integrated into YouTube TV Settings without focus-reset popups.
- **In-App Plugin Updates** — downloads `bundle.js` and `manifest.json` from GitHub Releases with SHA-256 verification and 3-boot safe-mode rollback, without reinstalling the APK.
- **Side-by-Side Install** — uses package `app.votv.youtube` without root. Sign in via `yt.be/activate` or microG (`app.revanced.android.gms`).

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <img src="../screenshots/panel.png" alt="VOTV side panel"><br>
      <sub>VOTV player side panel</sub>
    </td>
    <td align="center" width="50%">
      <img src="../screenshots/sponsorblock.png" alt="SponsorBlock timeline markers"><br>
      <sub>SponsorBlock markers on chapter timeline</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="../screenshots/settings-choice.png" alt="Inline settings options"><br>
      <sub>Inline choice options in Settings</sub>
    </td>
    <td align="center" width="50%">
      <img src="../screenshots/settings-bool.png" alt="VOTV settings toggles"><br>
      <sub>Native-style toggles inside YouTube Settings</sub>
    </td>
  </tr>
</table>

## Prebuilt APKs

This repository and GitHub Releases distribute only source code, patches, and JS plugin bundles (`bundle.js`, `manifest.json`). Prebuilt APKs are hosted separately at [sadthers.dev](https://sadthers.dev).

## Build

[`build/build.py`](../../build/build.py) auto-detects APKs in [`input/`](../../input/README.md), downloads `apktool` if missing, builds `@vot.js/core`, and generates a local signing keystore when none is provided.

**Prerequisites:** Python 3.10+ (with `Pillow`), Node.js 20+, Java JDK 17+ (`java`, `javac`, `keytool`), Android SDK (`build-tools` 35+ and `platforms/android-*`).

1. Clone the repository:
   ```bash
   git clone https://github.com/leon03131/votv.git
   cd votv
   ```
2. Put original YouTube for Android TV (`com.google.android.youtube.tv`, `8.02.300`) APK(s) for `arm`, `arm64`, or `x86` into `input/`.
3. Run [`build.bat`](../../build.bat) (Windows) or `./build.sh` (Linux/macOS). Signed APKs are written to `dist/`.

## Tests & Dev Mode

```bash
npm ci && npm run build:vot
npm test                                  # 61 JS tests
python -m unittest discover -s tests -v   # 37 Python tests
```

Live-reload plugins on TV without rebuilding the APK:

```bash
python dev/serve.py
adb shell setprop debug.votv.dev http://<PC_IP>:8080
adb shell am force-stop app.votv.youtube
```

## License

[GPL-3.0](../../LICENSE). Not affiliated with Google, YouTube, or Yandex.
