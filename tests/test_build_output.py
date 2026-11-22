"""Checks on a real build (run build/build.py first). Skipped when there is no build.

- work/patched: the decoded tree after patches (hooks on the right registers etc.)
- dist/*.apk: package, version, signature, host dex, bundle, native lib alignment
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import unittest
import zipfile
from pathlib import Path

CRLF = bytes([13, 10])

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugins"))
sys.path.insert(0, str(ROOT / "build"))

import bundle  # noqa: E402

CFG = json.loads((ROOT / "build/config.json").read_text(encoding="utf-8"))
PATCHED = ROOT / "work" / "patched"
DIST = ROOT / "dist"
APKS = sorted(DIST.glob(f"votv-{CFG['version_name']}-*.apk"))
SDK = Path(os.environ.get("ANDROID_HOME") or Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk")


def smali(descriptor: str) -> str:
    rel = descriptor[1:-1] + ".smali"
    for d in sorted(PATCHED.glob("smali*")):
        if (d / rel).exists():
            return (d / rel).read_text(encoding="utf-8")
    raise AssertionError(f"{descriptor} not found")


@unittest.skipUnless(PATCHED.exists(), "no work/patched (run build/build.py)")
class PatchedTree(unittest.TestCase):
    def test_manifest(self):
        mf = (PATCHED / "AndroidManifest.xml").read_text(encoding="utf-8")
        self.assertIn(f'package="{CFG["package"]}"', mf)
        self.assertNotIn(f'"{CFG["original_package"]}', mf)
        self.assertIn('android:usesCleartextTraffic="true"', mf)
        self.assertIn(f'<package android:name="{CFG["microg_package"]}"/>', mf)

    def test_injector_hook_register_is_the_injector(self):
        s = smali("Ldev/cobalt/shell/Shell;")
        m = re.search(r"invoke-static \{(v\d+)\}, Lapp/votv/host/Host;->onInjector", s)
        self.assertIsNotNone(m)
        before = s[: m.start()]
        # the injector's native pointer was read from this same register just before
        last_iget = re.findall(r"iget-wide v\d+, (v\d+), Lcobalt/org/chromium/content/browser/JavascriptInjectorImpl;->b:J", before)[-1]
        self.assertEqual(m.group(1), last_iget)
        after = s[m.end():]
        self.assertRegex(after.lstrip()[:400], r"^\(Ljava/lang/Object;\)V\s+invoke-static/range .*addInterface")

    def test_webcontents_hook_register(self):
        s = smali("Ldev/cobalt/shell/Shell;")
        m = re.search(r"invoke-direct \{[vp]\d+, ([vp]\d+)\}, Ldev/cobalt/shell/StartupGuardNavigationObserver;-><init>"
                      r"\(Lcobalt/org/chromium/content_public/browser/WebContents;\)V\s+invoke-static \{([vp]\d+)\}, "
                      r"Lapp/votv/host/Host;->onWebContents", s)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1), m.group(2))

    def test_bundle_bytes_are_exact(self):
        # copied into the APK as is; smali/manifest line endings are apktool's business (CRLF on Windows)
        self.assertNotIn(CRLF, (PATCHED / "assets/votv/bundle.js").read_bytes())

    def test_other_patches_present(self):
        self.assertIn(f'"{CFG["original_package"]}/{CFG["original_version"]}"', smali("Ldev/cobalt/coat/BaseStarboardBridge;"))
        obs = next(PATCHED.glob("smali*/app/votv/host/NavObserver.smali")).read_text(encoding="utf-8")
        guard = smali("Ldev/cobalt/shell/StartupGuardNavigationObserver;")
        self.assertIn(re.search(r"^\.super (\S+)", guard, re.M).group(0), obs)

    def test_bundle_is_release_bundle(self):
        shipped = (PATCHED / "assets/votv/bundle.js").read_bytes().decode("utf-8")  # exact bytes, no newline translation
        self.assertEqual(shipped, bundle.build())
        self.assertNotIn("plugin: emu", shipped)
        self.assertNotIn("plugin: selftest", shipped)


@unittest.skipUnless(APKS, "no APKs in dist/ for this version")
class Apks(unittest.TestCase):
    def aapt2(self):
        bt = max((SDK / "build-tools").iterdir(), key=lambda p: [int(x) for x in p.name.split(".") if x.isdigit()])
        return bt, bt / ("aapt2.exe" if os.name == "nt" else "aapt2")

    def test_badging(self):
        _, aapt2 = self.aapt2()
        for apk in APKS:
            out = subprocess.run([str(aapt2), "dump", "badging", str(apk)], capture_output=True, text=True).stdout
            self.assertIn(f"package: name='{CFG['package']}'", out, apk.name)
            self.assertIn(f"versionName='{CFG['version_name']}'", out)
            self.assertIn(f"application-label:'{CFG['label']}'", out)
            code = int(re.search(r"versionCode='(\d+)'", out).group(1))
            prefix = "".join(CFG["original_version"].split("."))
            self.assertTrue(str(code).startswith(prefix), code)  # original per-ABI code kept

    def test_contents(self):
        for apk in APKS:
            with zipfile.ZipFile(apk) as z:
                names = z.namelist()
                dex = b"".join(z.read(n) for n in names if re.fullmatch(r"classes\d*\.dex", n))
                for cls in [b"Lapp/votv/host/Host;", b"Lapp/votv/host/VotHost;", b"Lapp/votv/host/NavObserver;",
                            b"Lapp/votv/host/JsApi;", b"Lapp/votv/host/Gms;"]:
                    self.assertIn(cls, dex, f"{cls} missing in {apk.name}")
                self.assertEqual(z.read("assets/votv/bundle.js").decode("utf-8"), bundle.build())
                self.assertIn("res/drawable-xhdpi/app_banner.png", names)
                sos = [i for i in z.infolist() if i.filename.endswith(".so")]
                self.assertTrue(sos)
                abi_dirs = {i.filename.split("/")[1] for i in sos}
                self.assertEqual(len(abi_dirs), 1, apk.name)

    def test_native_libs_stored_and_page_aligned(self):
        for apk in APKS:
            with zipfile.ZipFile(apk) as z, open(apk, "rb") as f:
                for i in z.infolist():
                    if not i.filename.endswith(".so"):
                        continue
                    self.assertEqual(i.compress_type, zipfile.ZIP_STORED, i.filename)
                    f.seek(i.header_offset + 26)
                    n, m = int.from_bytes(f.read(2), "little"), int.from_bytes(f.read(2), "little")
                    data = i.header_offset + 30 + n + m
                    self.assertEqual(data % 4096, 0, f"{i.filename} not page aligned in {apk.name}")

    def test_signature(self):
        bt, _ = self.aapt2()
        signer = bt / ("apksigner.bat" if os.name == "nt" else "apksigner")
        for apk in APKS:
            r = subprocess.run([str(signer), "verify", "--print-certs", str(apk)], capture_output=True, text=True,
                               shell=os.name == "nt")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("CN=votv", r.stdout)


if __name__ == "__main__":
    unittest.main()
