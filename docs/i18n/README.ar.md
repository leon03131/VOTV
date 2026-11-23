<p align="center">
  <a href="../../README.md">Русский</a> ·
  <a href="README.en.md">English</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.hi.md">हिन्दी</a> ·
  <strong>العربية</strong> ·
  <a href="README.pt.md">Português</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="../../branding/res/drawable-xhdpi/app_banner.png" width="420" alt="VOTV">
</p>

# VOTV

تعديلات وإضافات JavaScript لتطبيق **YouTube for Android TV (8.02.300)** الرسمي: الدبلجة الصوتية من Yandex، و SponsorBlock، وإزالة الإعلانات.

[sadthers.dev/votv](https://sadthers.dev/votv/) · [إصدارات الإضافات](https://github.com/leon03131/votv/releases) · [اختبارات CI](https://github.com/leon03131/votv/actions/workflows/test.yml) · YouTube TV `8.02.300` · [GPL-3.0](../../LICENSE)

---

## المميزات

- **الدبلجة الصوتية من Yandex (`@vot.js/core`)** — ترجمة صوتية إلى الروسية أو الإنجليزية أو الكازاخية عبر مشغل `AudioPlayer` أصلي في Java مع مزامنة السرعة، وتعديل مستوى الصوت، والترجمة النصية، والتبديل التلقائي عند الحاجة.
- **SponsorBlock** — علامات ملونة فوق شريط التشغيل والفصول، تخطي تلقائي، دمج المقاطع المتجاورة، تخطي يدوي، ودعم الترجيع للخلف.
- **إزالة الإعلانات** — حذف الإعلانات من استجابات المشغل وقوائم الفيديو.
- **واجهة جهاز التحكم عن بُعد** — لوحة جانبية داخل المشغل وإعدادات موحدة مباشرة داخل قائمة إعدادات YouTube دون فقدان التركيز.
- **تحديث الإضافات** — تحميل `bundle.js` و `manifest.json` من GitHub Releases مع التحقق عبر SHA-256 دون إعادة تثبيت APK.
- **تثبيت موازٍ** — حزمة `app.votv.youtube` بدون روت، وتسجيل الدخول عبر `yt.be/activate` أو microG.

## لقطات الشاشة

<table>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/panel.png" alt="VOTV Panel"><br><sub>لوحة VOTV الجانبية في المشغل</sub></td>
    <td align="center" width="50%"><img src="../screenshots/sponsorblock.png" alt="SponsorBlock"><br><sub>علامات SponsorBlock على شريط الفصول</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/settings-choice.png" alt="Settings"><br><sub>خيارات مدمجة داخل الإعدادات</sub></td>
    <td align="center" width="50%"><img src="../screenshots/settings-bool.png" alt="Toggles"><br><sub>أزرار تبديل بنمط YouTube TV الأصلي</sub></td>
  </tr>
</table>

## ملفات APK والبناء

ملفات APK الجاهزة والموقعة (`arm` و `arm64` و `x86`) متاحة للتنزيل على **[sadthers.dev/votv](https://sadthers.dev/votv/)**. يستضيف GitHub الكود المصدري والتعديلات وحزم JS فقط (`bundle.js` و `manifest.json`).

**البناء المحلي** (Python 3.10+ و Node.js 20+ و JDK 17+ و Android SDK build-tools 35+):
1. `git clone https://github.com/leon03131/votv.git && cd votv`
2. ضع ملفات APK الأصلية لتطبيق YouTube for Android TV (`8.02.300`، `arm` / `arm64` / `x86`) في مجلد `input/`.
3. شغّل `build.bat` (Windows) أو `./build.sh` (Linux/macOS)، وستجد الملفات الموقعة في `dist/`.

## الرخصة

[GPL-3.0](../../LICENSE). غير تابع لشركة Google أو YouTube أو Yandex.
