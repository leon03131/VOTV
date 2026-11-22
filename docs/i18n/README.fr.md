<p align="center">
  <a href="../../README.md">Русский</a> ·
  <a href="README.en.md">English</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.hi.md">हिन्दी</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.pt.md">Português</a> ·
  <strong>Français</strong> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="../../branding/res/drawable-xhdpi/app_banner.png" width="420" alt="VOTV">
</p>

# VOTV

Patchs et plugins JavaScript pour **YouTube for Android TV (8.02.300)** : doublage vocal Yandex, SponsorBlock et suppression des publicités.

[sadthers.dev](https://sadthers.dev) · [Versions des plugins](https://github.com/leon03131/votv/releases) · [Tests CI](https://github.com/leon03131/votv/actions/workflows/test.yml) · YouTube TV `8.02.300` · [GPL-3.0](../../LICENSE)

---

## Fonctionnalités

- **Doublage vocal Yandex (`@vot.js/core`)** — traduction vocale en russe, anglais ou kazakh via un `AudioPlayer` Java natif avec synchronisation fluide, réglage indépendant du volume, sous-titres VOT et repli automatique.
- **SponsorBlock** — marqueurs sur la barre de lecture et les chapitres, saut automatique, segments chaînés, invite manuelle et gestion du retour en arrière.
- **Sans publicité** — supprime les annonces des réponses du lecteur et des flux.
- **Interface télécommande** — panneau latéral dans le lecteur et paramètres unifiés intégrés directement dans les réglages YouTube sans perte de focus.
- **Mise à jour des plugins** — télécharge `bundle.js` et `manifest.json` depuis GitHub Releases avec vérification SHA-256 sans réinstaller l'APK.
- **Installation parallèle** — paquet `app.votv.youtube`, sans root, connexion via `yt.be/activate` ou microG.

## Captures

<table>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/panel.png" alt="Panneau VOTV"><br><sub>Panneau latéral VOTV dans le lecteur</sub></td>
    <td align="center" width="50%"><img src="../screenshots/sponsorblock.png" alt="SponsorBlock"><br><sub>Marqueurs SponsorBlock sur les chapitres</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/settings-choice.png" alt="Paramètres"><br><sub>Choix en ligne dans les Paramètres</sub></td>
    <td align="center" width="50%"><img src="../screenshots/settings-bool.png" alt="Interrupteurs"><br><sub>Interrupteurs natifs dans YouTube TV</sub></td>
  </tr>
</table>

## APK et compilation

GitHub héberge uniquement le code source, les patchs et les bundles JS (`bundle.js`, `manifest.json`). Les APK compilés seront publiés sur [sadthers.dev](https://sadthers.dev).

**Compilation locale** (Python 3.10+, Node.js 20+, JDK 17+, Android SDK build-tools 35+) :
1. `git clone https://github.com/leon03131/votv.git && cd votv`
2. Placez les APK originaux de YouTube for Android TV (`8.02.300`, `arm` / `arm64` / `x86`) dans `input/`.
3. Exécutez `build.bat` (Windows) ou `./build.sh` (Linux/macOS) ; les APK signés seront générés dans `dist/`.

## Licence

[GPL-3.0](../../LICENSE). Non affilié à Google, YouTube ou Yandex.
