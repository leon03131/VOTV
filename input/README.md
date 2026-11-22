# Папка для исходных APK / Input APKs folder

Поместите сюда оригинальный APK-файл **YouTube для Android TV** (версия **`8.02.300`**) для нужной архитектуры (`arm`, `arm64` или `x86` — можно один или сразу все три) и запустите сборку:

- **Windows:** дважды кликните `build.bat` в корне проекта (или выполните `python build/build.py`)
- **Linux / macOS:** `./build.sh` (или `python3 build/build.py`)

Готовые подписанные APK появятся в папке `dist/`.

> APK-файлы в этой папке (`.apk`) автоматически игнорируются Git и не попадают в репозиторий.

---

Place original **YouTube for Android TV (`8.02.300`)** APK file(s) here (one or more of `arm`, `arm64`, `x86`) and run `build.bat` (Windows) or `./build.sh` (Linux/macOS). Signed APKs will appear in `dist/`.
