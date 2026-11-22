<p align="center">
  <a href="../../README.md">Русский</a> ·
  <a href="README.en.md">English</a> ·
  <a href="README.zh.md">中文</a> ·
  <strong>Español</strong> ·
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

Parches y plugins JavaScript para **YouTube for Android TV (8.02.300)**: traducción de voz de Yandex, SponsorBlock y eliminación de anuncios.

[sadthers.dev](https://sadthers.dev) · [Versiones de plugins](https://github.com/leon03131/votv/releases) · [Tests CI](https://github.com/leon03131/votv/actions/workflows/test.yml) · YouTube TV `8.02.300` · [GPL-3.0](../../LICENSE)

---

## Características

- **Doblaje de voz de Yandex (`@vot.js/core`)** — traducción al ruso, inglés o kazajo mediante un `AudioPlayer` nativo en Java con sincronización de velocidad, volumen independiente, subtítulos VOT y respaldo automático.
- **SponsorBlock** — marcadores sobre la barra de reproducción y capítulos, salto automático, segmentos encadenados, aviso manual y manejo al retroceder.
- **Sin anuncios** — elimina anuncios de las respuestas del reproductor y feeds.
- **Interfaz para TV** — panel lateral en el reproductor y ajustes unificados en línea dentro de la configuración de YouTube sin pérdida de foco.
- **Actualización de plugins** — descarga `bundle.js` y `manifest.json` desde GitHub Releases con verificación SHA-256 sin reinstalar el APK.
- **Instalación paralela** — paquete `app.votv.youtube`, sin root, acceso vía `yt.be/activate` o microG.

## Capturas

<table>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/panel.png" alt="Panel VOTV"><br><sub>Panel lateral VOTV en el reproductor</sub></td>
    <td align="center" width="50%"><img src="../screenshots/sponsorblock.png" alt="SponsorBlock"><br><sub>Marcadores SponsorBlock en capítulos</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/settings-choice.png" alt="Ajustes"><br><sub>Opciones en línea dentro de Configuración</sub></td>
    <td align="center" width="50%"><img src="../screenshots/settings-bool.png" alt="Interruptores"><br><sub>Interruptores nativos en YouTube TV</sub></td>
  </tr>
</table>

## APK y compilación

GitHub distribuye únicamente código fuente, parches y paquetes JS (`bundle.js`, `manifest.json`). Los APK compilados se publicarán en [sadthers.dev](https://sadthers.dev).

**Compilación local** (Python 3.10+, Node.js 20+, JDK 17+, Android SDK build-tools 35+):
1. `git clone https://github.com/leon03131/votv.git && cd votv`
2. Coloca los APK originales de YouTube for Android TV (`8.02.300`, `arm` / `arm64` / `x86`) en `input/`.
3. Ejecuta `build.bat` (Windows) o `./build.sh` (Linux/macOS); los APK firmados quedarán en `dist/`.

## Licencia

[GPL-3.0](../../LICENSE). No afiliado con Google, YouTube ni Yandex.
