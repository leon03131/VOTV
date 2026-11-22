<p align="center">
  <a href="../../README.md">Русский</a> ·
  <a href="README.en.md">English</a> ·
  <strong>中文</strong> ·
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

面向官方 **YouTube for Android TV (8.02.300)** 的补丁与 JavaScript 插件集合：集成 Yandex 语音配音、SponsorBlock 片段跳过和去广告功能。

[sadthers.dev](https://sadthers.dev) · [插件发布](https://github.com/leon03131/votv/releases) · [CI 测试](https://github.com/leon03131/votv/actions/workflows/test.yml) · YouTube TV `8.02.300` · [GPL-3.0](../../LICENSE)

---

## 功能特性

- **Yandex 语音配音 (`@vot.js/core`)** — 支持俄语、英语和哈萨克语配音；Java 宿主原生 `AudioPlayer` 提供无漂移同步、配音/原声独立音量、VOT 字幕、`PART_CONTENT` / `AUDIO_REQUESTED` 流处理以及标准语音/代理回退。
- **SponsorBlock** — 通过 SHA-256 前缀查询片段，直接在进度条和章节条上绘制标记，支持自动跳过、相邻片段合并、手动提示及回退防重跳。
- **去除广告** — 移除播放器响应与推荐信息流中的广告。
- **电视遥控器界面** — 播放器侧边栏与整合进 YouTube 原生“设置”的 VOTV/SponsorBlock 内联选项，退出不丢失焦点。
- **插件在线更新** — 从 GitHub Releases 下载并校验 SHA-256 的 `bundle.js` 与 `manifest.json`（支持 3 次启动失败回滚），无需重装 APK。
- **共存安装** — 独立包名 `app.votv.youtube`，免 Root，支持 `yt.be/activate` 或 microG 登录。

## 截图

<table>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/panel.png" alt="VOTV Panel"><br><sub>播放器 VOTV 侧边栏</sub></td>
    <td align="center" width="50%"><img src="../screenshots/sponsorblock.png" alt="SponsorBlock"><br><sub>章节时间轴上的 SponsorBlock 标记</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="../screenshots/settings-choice.png" alt="Settings Choice"><br><sub>设置中的内联单选列表</sub></td>
    <td align="center" width="50%"><img src="../screenshots/settings-bool.png" alt="Settings Bool"><br><sub>YouTube 设置中的原生开关样式</sub></td>
  </tr>
</table>

## 下载与构建

GitHub 仅托管源码、补丁和 JS 插件包（`bundle.js`、`manifest.json`）。成品 APK 将发布在 [sadthers.dev](https://sadthers.dev)。

**本地构建**（需 Python 3.10+、Node.js 20+、JDK 17+、Android SDK build-tools 35+）：
1. `git clone https://github.com/leon03131/votv.git && cd votv`
2. 将原版 YouTube for Android TV（`8.02.300`，`arm` / `arm64` / `x86`）APK 放入 `input/`。
3. 运行 `build.bat`（Windows）或 `./build.sh`（Linux/macOS），签名后的 APK 将输出到 `dist/`。

## 开源协议

[GPL-3.0](../../LICENSE)。本项目与 Google、YouTube 或 Yandex 无关。
