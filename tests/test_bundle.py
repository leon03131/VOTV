"""Tests for plugins/bundle.py: plugin selection, guards, syntax checking."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugins"))

import bundle  # noqa: E402

HAS_NODE = shutil.which("node") is not None


class Selection(unittest.TestCase):
    def test_release_has_no_dev_plugins(self):
        out = bundle.build()
        self.assertIn("/* plugin: diag */", out)
        self.assertNotIn("/* plugin: emu */", out)
        self.assertNotIn("/* plugin: selftest */", out)

    def test_dev_adds_dev_plugins_but_not_disabled_ones(self):
        out = bundle.build(dev=True)
        self.assertIn("/* plugin: emu */", out)
        self.assertNotIn("/* plugin: selftest */", out)  # enabled: false

    def test_include_forces_a_plugin(self):
        self.assertIn("/* plugin: selftest */", bundle.build(dev=True, include=("selftest",)))

    def test_core_first_and_guarded(self):
        out = bundle.build()
        self.assertTrue(out.startswith("/* votv bundle */\n(function () {\nif (window.__votvBundle) return;"))
        self.assertLess(out.index("window.__votv = {"), out.index("/* plugin: diag */"))

    def test_every_plugin_file_exists(self):
        for p in bundle.spec()["plugins"]:
            self.assertTrue((ROOT / "plugins" / p["file"]).exists(), p["file"])

    def test_manifest_generation_and_sha256(self):
        text = bundle.build()
        mf = bundle.build_manifest(
            text,
            version="8.02.300-votv.8",
            min_api=4,
            bundle_url="https://example.com/bundle.js",
            apk_version="8.02.300-votv.8",
        )
        self.assertEqual(mf["pluginVersion"], "8.02.300-votv.8")
        self.assertEqual(mf["minHostApi"], 4)
        self.assertEqual(mf["bundleUrl"], "https://example.com/bundle.js")
        self.assertEqual(mf["sha256"], hashlib.sha256(text.encode("utf-8")).hexdigest())

    def test_cli_manifest_output(self):
        with tempfile.TemporaryDirectory() as d:
            out_dir = Path(d) / "rel"
            r = subprocess.run(
                [sys.executable, str(ROOT / "plugins" / "bundle.py"), "--manifest", str(out_dir), "--version", "1.2.3"],
                capture_output=True, text=True, check=True,
            )
            self.assertTrue((out_dir / "bundle.js").exists())
            mf = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(mf["pluginVersion"], "1.2.3")
            self.assertEqual(
                mf["sha256"],
                hashlib.sha256((out_dir / "bundle.js").read_bytes()).hexdigest(),
            )
            self.assertIn("manifest.json", r.stdout)


@unittest.skipUnless(HAS_NODE, "node not installed")
class SyntaxCheck(unittest.TestCase):
    def test_broken_plugin_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            shutil.copytree(ROOT / "plugins", d / "plugins")
            if (ROOT / "node_modules").exists():
                try:
                    (d / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
                except OSError:
                    try:
                        import _winapi
                        _winapi.CreateJunction(str(ROOT / "node_modules"), str(d / "node_modules"))
                    except Exception:
                        pass
            (d / "plugins/diag/diag.js").write_text("__votv.define('diag', () => { return { ; });", encoding="utf-8")
            with mock.patch.object(bundle, "HERE", d / "plugins"):
                with self.assertRaises(bundle.BundleError) as cm:
                    bundle.build()
            self.assertIn("diag", str(cm.exception))

    def test_real_plugins_parse(self):
        for p in bundle.spec()["plugins"]:
            bundle.check_syntax(ROOT / "plugins" / p["file"])


if __name__ == "__main__":
    unittest.main()
