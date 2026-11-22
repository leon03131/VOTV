"""Unit tests for patches/ on a synthetic decoded APK (tests/fixture.py).

    python -m unittest discover -s tests -v
"""
from __future__ import annotations

import re
import sys
import tempfile
import unittest
from pathlib import Path

CRLF = bytes([13, 10])

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import fixture  # noqa: E402
from patches import (Ctx, PatchError, branding, client_id, find_method, gms, host_bridge,  # noqa: E402
                     package_name, primes, replace_method_body)


class PatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = fixture.make(Path(self.tmp.name))
        bundle = Path(self.tmp.name) / "bundle.js"
        bundle.write_text("/* bundle */", encoding="utf-8")
        self.ctx = Ctx(root=self.root, cfg={**fixture.CFG, "_bundle": str(bundle)})

    def tearDown(self):
        self.tmp.cleanup()

    def read(self, rel: str) -> str:
        return (self.root / rel).read_text(encoding="utf-8")


class Helpers(unittest.TestCase):
    TEXT = ".class LA;\n.method public a()V\n    return-void\n.end method\n\n.method public b(I)I\n    return p1\n.end method\n"

    def test_find_method_exact_and_regex(self):
        s, e = find_method(self.TEXT, "b(I)I")
        self.assertTrue(self.TEXT[s:e].startswith(".method public b(I)I"))
        self.assertTrue(self.TEXT[s:e].endswith(".end method"))
        find_method(self.TEXT, re.compile(r"^\.method public \w\(\)V$"))

    def test_find_method_requires_exactly_one(self):
        with self.assertRaises(PatchError):
            find_method(self.TEXT, "c()V")
        with self.assertRaises(PatchError):
            find_method(self.TEXT, re.compile(r"^\.method public"))

    def test_replace_method_body_keeps_header_and_neighbours(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "A.smali"
            p.write_text(self.TEXT, encoding="utf-8")
            replace_method_body(p, "a()V", "    .locals 0\n    nop\n    return-void")
            out = p.read_text(encoding="utf-8")
        self.assertIn(".method public a()V\n    .locals 0\n    nop\n    return-void\n.end method", out)
        self.assertIn(".method public b(I)I\n    return p1\n.end method", out)


class PackageName(PatchTest):
    def test_manifest(self):
        package_name.apply(self.ctx)
        mf = self.read("AndroidManifest.xml")
        self.assertIn('package="app.votv.youtube"', mf)
        self.assertNotIn('"com.google.android.youtube.tv', mf)  # no value left with the old package
        self.assertIn('"app.votv.youtube.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"', mf)
        self.assertIn('android:taskAffinity="app.votv.youtube.main"', mf)
        self.assertIn('android:process="app.votv.youtube.recommendations"', mf)
        # Java class names are untouched
        self.assertIn("com.google.android.apps.youtube.tv.activity.ShellActivity", mf)
        self.assertIn('android:label="YouTube VOTV"', mf)
        self.assertIn('<package android:name="app.revanced.android.gms"/>', mf)
        self.assertIn("versionName: 7.30.301-votv.test", self.read("apktool.yml"))
        self.assertIn("versionCode: 730301320", self.read("apktool.yml"))

    def test_wrong_package_fails(self):
        p = self.root / "AndroidManifest.xml"
        p.write_text(p.read_text(encoding="utf-8").replace('package="com.google.android.youtube.tv"', 'package="x.y"'), encoding="utf-8")
        with self.assertRaises(PatchError):
            package_name.apply(self.ctx)


class Gms(PatchTest):
    def test_strings_permissions_and_availability(self):
        gms.apply(self.ctx)
        s = self.read("smali_classes2/gmsuser.smali")
        self.assertNotIn('"com.google.android.gms"', s)
        self.assertEqual(s.count('"app.revanced.android.gms"'), 32)
        self.assertIn('"app.revanced.android.gms.droidguard.service.START"', s)
        self.assertIn('const-string/jumbo v0, "app.revanced.android.gsf.login"', s)
        self.assertIn('"com.google.android.gms.cast.tv.action.LAUNCH"', s)  # not in the list
        self.assertIn('"com.google.android.gmsx"', s)  # only exact strings
        mf = self.read("AndroidManifest.xml")
        self.assertIn('"app.revanced.android.providers.gsf.permission.READ_GSERVICES"', mf)
        self.assertIn('"app.revanced.android.gms.permission.AD_ID"', mf)
        self.assertIn('"com.google.android.gms.cast.tv.action.LAUNCH"', mf)  # intent actions untouched
        d = self.read("smali_classes2/dlk.smali")
        self.assertIn("Lapp/votv/host/Gms;->availability(Landroid/content/Context;)I", d)
        self.assertNotIn("Ldmb;->b", d)
        self.assertIn('"gcore_"', d)  # the other method is untouched

    def test_too_few_strings_is_an_error(self):
        fixture.make(self.root, gms_strings=3)
        with self.assertRaises(PatchError):
            gms.apply(self.ctx)


class ClientId(PatchTest):
    def test_user_agent_aux(self):
        client_id.apply(self.ctx)
        s = self.read("smali_classes2/dev/cobalt/coat/BaseStarboardBridge.smali")
        self.assertIn('const-string v0, "com.google.android.youtube.tv/7.30.301"', s)
        self.assertNotIn("StringBuilder", s)


class Primes(PatchTest):
    def test_allowlist_always_true(self):
        primes.apply(self.ctx)
        s = self.read("smali_classes2/elc.smali")
        body = s[s.index(".method public final a()Z"):]
        self.assertIn("const/4 v0, 0x1\n    return v0", body)
        self.assertIn(".method public static b()Z\n    .locals 1\n    const/4 v0, 0x0", s)  # robolectric check kept

    def test_missing_class_fails(self):
        (self.root / "smali_classes2/elc.smali").unlink()
        with self.assertRaises(PatchError):
            primes.apply(self.ctx)


class HostBridge(PatchTest):
    def test_shell_hooks_use_the_right_registers(self):
        host_bridge.apply(self.ctx)
        s = self.read("smali/dev/cobalt/shell/Shell.smali")
        # injector: the object register of iget-wide ...->b:J (v5), right before addInterface
        self.assertRegex(s, r"invoke-static \{v5\}, Lapp/votv/host/Host;->onInjector\(Ljava/lang/Object;\)V\n\n\s*invoke-static/range \{v3 \.\. v9\}")
        # webContents: the 2nd register of the observer constructor (v0), right after it
        self.assertRegex(s, r"StartupGuardNavigationObserver;-><init>\(Lcobalt/org/chromium/content_public/browser/WebContents;\)V\n\n\s*invoke-static \{v0\}, Lapp/votv/host/Host;->onWebContents")

    def test_written_files_use_lf(self):
        host_bridge.apply(self.ctx)
        for rel in ["smali/dev/cobalt/shell/Shell.smali", "AndroidManifest.xml"]:
            self.assertNotIn(CRLF, (self.root / rel).read_bytes(), rel)

    def test_nav_observer_and_assets(self):
        host_bridge.apply(self.ctx)
        obs = next(self.root.glob("smali*/app/votv/host/NavObserver.smali")).read_text(encoding="utf-8")
        self.assertIn(".super Lbuh;", obs)
        self.assertIn("invoke-direct {p0, p1}, Lbuh;-><init>(Lcobalt/org/chromium/content_public/browser/WebContents;)V", obs)
        for m in ["primaryMainDocumentElementAvailable()V", "webContentsDestroyed()V",
                  "didFinishNavigationInPrimaryMainFrame(Lcobalt/org/chromium/content_public/browser/NavigationHandle;)V"]:
            self.assertIn(f".method public {m}", obs)
        self.assertEqual(self.read("assets/votv/bundle.js"), "/* bundle */")
        self.assertIn('android:usesCleartextTraffic="true"', self.read("AndroidManifest.xml"))

    def test_observer_base_without_needed_method_fails(self):
        p = self.root / "smali/buh.smali"
        p.write_text(p.read_text(encoding="utf-8").replace("primaryMainDocumentElementAvailable", "somethingElse"), encoding="utf-8")
        with self.assertRaises(PatchError):
            host_bridge.apply(self.ctx)

    def test_two_addinterface_calls_fail(self):
        p = self.root / "smali/dev/cobalt/shell/Shell.smali"
        t = p.read_text(encoding="utf-8")
        call = next(line for line in t.splitlines() if "addInterface(" in line)
        p.write_text(t.replace(call, call + "\n" + call), encoding="utf-8")
        with self.assertRaises(PatchError):
            host_bridge.apply(self.ctx)

    def test_high_register_is_refused(self):
        p = self.root / "smali/dev/cobalt/shell/Shell.smali"
        p.write_text(p.read_text(encoding="utf-8").replace("{v3 .. v9}", "{v14 .. v20}"), encoding="utf-8")
        with self.assertRaises(PatchError):
            host_bridge.apply(self.ctx)


class Branding(PatchTest):
    def test_replaces_and_adds_density(self):
        branding.apply(self.ctx)
        self.assertNotEqual((self.root / "res/mipmap-xxxhdpi/ic_launcher.png").read_bytes(), b"old")
        self.assertTrue((self.root / "res/drawable-xhdpi/app_banner.png").exists())
        src = ROOT / "branding/res/drawable/app_banner.png"
        self.assertEqual((self.root / "res/drawable/app_banner.png").read_bytes(), src.read_bytes())


class AllPatchesInBuildOrder(PatchTest):
    def test_full_chain(self):
        sys.path.insert(0, str(ROOT / "build"))
        import build  # noqa: E402
        for p in build.PATCHES:
            p.apply(self.ctx)
        self.assertGreaterEqual(len(self.ctx.notes), 8)


if __name__ == "__main__":
    unittest.main()
