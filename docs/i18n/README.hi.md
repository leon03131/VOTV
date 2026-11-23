<p align="center">
  <a href="../../README.md">Русский</a> ·
  <a href="README.en.md">English</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.es.md">Español</a> ·
  <strong>हिन्दी</strong> ·
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

आधिकारिक **YouTube for Android TV (8.02.300)** के लिए पैच और JavaScript प्लगइन्स: Yandex वॉइस-ओवर अनुवाद, SponsorBlock और विज्ञापन हटाना।

[sadthers.dev/votv](https://sadthers.dev/votv/) · [प्लगइन रिलीज़](https://github.com/leon03131/votv/releases) · [CI टेस्ट](https://github.com/leon03131/votv/actions/workflows/test.yml) · YouTube TV `8.02.300` · [GPL-3.0](../../LICENSE)

---

## विशेषताएँ

- **Yandex वॉइस-ओवर अनुवाद (`@vot.js/core`)** — रूसी, अंग्रेज़ी या कज़ाख में अनुवाद; नेटिव Java `AudioPlayer`, अलग वॉल्यूम नियंत्रण, VOT सबटाइटल्स और स्वचालित फ़ॉलबैक।
- **SponsorBlock** — YouTube प्रोग्रेस बार और चैप्टर्स पर सेगमेंट मार्कर, ऑटो-स्किप, मैन्युअल प्रॉम्प्ट और रिवाइंड सपोर्ट।
- **विज्ञापन-मुक्त प्लेबैक** — प्लेयर और फ़ीड से विज्ञापन हटाता है।
- **टीवी रिमोट UI** — प्लेयर में VOTV साइड पैनल और YouTube सेटिंग्स के भीतर बिना पॉपअप के एकीकृत इनलाइन विकल्प।
- **प्लगइन अपडेट** — APK दोबारा इंस्टॉल किए बिना GitHub Releases से SHA-256 सत्यापित अपडेट।
- **साइड-बाय-साइड इंस्टॉलेशन** — पैकेज `app.votv.youtube`, बिना रूट, `yt.be/activate` या microG द्वारा लॉगिन।

## स्क्रीनशॉट

<table>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/panel.png" alt="VOTV Panel"><br><sub>प्लेयर में VOTV साइड पैनल</sub></td>
    <td align="center" width="50%"><img src="../screenshots/sponsorblock.png" alt="SponsorBlock"><br><sub>चैप्टर टाइमलाइन पर SponsorBlock मार्कर</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/settings-choice.png" alt="Settings"><br><sub>सेटिंग्स में इनलाइन विकल्प</sub></td>
    <td align="center" width="50%"><img src="../screenshots/settings-bool.png" alt="Toggles"><br><sub>YouTube सेटिंग्स में नेटिव टॉगल</sub></td>
  </tr>
</table>

## APK और बिल्ड

तैयार हस्ताक्षरित APK (`arm`, `arm64`, `x86`) **[sadthers.dev/votv](https://sadthers.dev/votv/)** पर उपलब्ध हैं। GitHub पर केवल सोर्स कोड, पैच और JS प्लगइन बंडल (`bundle.js`, `manifest.json`) उपलब्ध हैं।

**स्थानीय बिल्ड** (Python 3.10+, Node.js 20+, JDK 17+, Android SDK build-tools 35+):
1. `git clone https://github.com/leon03131/votv.git && cd votv`
2. मूल YouTube for Android TV (`8.02.300`, `arm` / `arm64` / `x86`) APK को `input/` में रखें।
3. `build.bat` (Windows) या `./build.sh` (Linux/macOS) चलाएँ; हस्ताक्षरित APK `dist/` में बन जाएँगे।

## लाइसेंस

[GPL-3.0](../../LICENSE). Google, YouTube या Yandex से संबद्ध नहीं।
