#!/usr/bin/env python3
"""Join core + enabled plugins into one bundle.js (what the host evaluates in the page).

    python plugins/bundle.py [out.js] [--dev]
    python plugins/bundle.py --manifest <dir> [--version VER] [--apk-version VER] [--min-api 4] [--base-url URL]

The whole bundle is guarded so evaluating it twice in one document is a no-op (otherwise
plugins would register twice). Each plugin runs in its own try/catch, so a plugin that
throws while loading can't stop the others. A *syntax* error would still break the whole
bundle (JS parses the file before running it), so every file is syntax-checked with Node
when Node is available - the build and the dev server refuse a broken plugin.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


class BundleError(Exception):
    pass


def spec() -> dict:
    return json.loads((HERE / "plugins.json").read_text(encoding="utf-8"))


def selected(dev: bool, include: tuple[str, ...] = ()) -> list[dict]:
    """Enabled plugins (devOnly ones only for dev); `include` force-adds plugins by id."""
    return [p for p in spec()["plugins"]
            if p["id"] in include or (p.get("enabled", True) and (dev or not p.get("devOnly")))]


def check_syntax(path: Path) -> None:
    node = shutil.which("node")
    if not node:
        return
    r = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        name = path.relative_to(HERE) if path.is_relative_to(HERE) else path.name
        raise BundleError(f"syntax error in {name}:\n{r.stderr.strip()}")


def run_build(p: dict) -> None:
    """Plugins with a "build" script (e.g. vot bundles @vot.js/core with esbuild) are built
    first. Needs Node and `npm install` in the repo root."""
    node = shutil.which("node")
    if not node:
        raise BundleError(f"plugin {p['id']} needs Node to build ({p['build']})")
    r = subprocess.run([node, str(HERE / p["build"])], capture_output=True, text=True, cwd=HERE.parent)
    if r.returncode != 0:
        raise BundleError(f"build of plugin {p['id']} failed (did you run `npm install`?):\n{(r.stderr or r.stdout).strip()[-1500:]}")


def build(dev: bool = False, include: tuple[str, ...] = ()) -> str:
    s = spec()
    parts = []
    for rel in ([s["core"]] if isinstance(s["core"], str) else s["core"]):
        core = HERE / rel
        check_syntax(core)
        parts.append(f"/* core: {rel} */\n" + core.read_text(encoding="utf-8"))
    for p in selected(dev, include):
        path = HERE / p["file"]
        if p.get("build"):
            run_build(p)
        check_syntax(path)
        src = path.read_text(encoding="utf-8")
        pid = json.dumps(p["id"])
        parts.append(f"/* plugin: {p['id']} */\ntry {{\n{src}\n}} catch (e) {{ window.__votv && __votv.error('plugin ' + {pid} + ' crashed at load', e); }}")
    body = "\n".join(parts)
    out = ("/* votv bundle */\n(function () {\nif (window.__votvBundle) return;\nwindow.__votvBundle = true;\n"
           f"{body}\n}})();\n")
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(out)
    try:
        check_syntax(Path(f.name))
    except BundleError as e:
        raise BundleError(f"bundle does not parse: {e}") from None
    finally:
        Path(f.name).unlink(missing_ok=True)
    return out


def build_manifest(
    bundle_text: str,
    version: str,
    min_api: int = 4,
    bundle_url: str = "",
    apk_version: str = "",
    apk_url: str = "https://sadthers.dev/votv/",
) -> dict:
    sha256 = hashlib.sha256(bundle_text.encode("utf-8")).hexdigest()
    return {
        "pluginVersion": version,
        "minHostApi": min_api,
        "bundleUrl": bundle_url,
        "sha256": sha256,
        "apkVersion": apk_version or version,
        "apkUrl": apk_url,
    }


def _default_version() -> str:
    cfg = HERE.parent / "build" / "config.json"
    if cfg.exists():
        return json.loads(cfg.read_text(encoding="utf-8")).get("version_name", "0.0.0")
    return "0.0.0"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", type=Path, help="output bundle.js path")
    ap.add_argument("--dev", action="store_true")
    ap.add_argument("--manifest", type=Path, help="directory to write bundle.js and manifest.json")
    ap.add_argument("--version", default="")
    ap.add_argument("--apk-version", default="")
    ap.add_argument("--min-api", type=int, default=4)
    ap.add_argument("--base-url", default="https://github.com/leon03131/votv/releases/latest/download")
    ap.add_argument("--apk-url", default="https://sadthers.dev/votv/")
    ns = ap.parse_args()

    bundle_text = build(dev=ns.dev)
    if ns.manifest:
        ns.manifest.mkdir(parents=True, exist_ok=True)
        bpath = ns.manifest / "bundle.js"
        bpath.write_text(bundle_text, encoding="utf-8", newline="\n")
        ver = ns.version or _default_version()
        base = ns.base_url.rstrip("/")
        mf = build_manifest(
            bundle_text,
            version=ver,
            min_api=ns.min_api,
            bundle_url=f"{base}/bundle.js" if base else "",
            apk_version=ns.apk_version or ver,
            apk_url=ns.apk_url,
        )
        mpath = ns.manifest / "manifest.json"
        mpath.write_text(json.dumps(mf, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(bpath, bpath.stat().st_size, "bytes")
        print(mpath, mf["sha256"])
    else:
        out = ns.out or (HERE.parent / "work" / "bundle.js")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(bundle_text, encoding="utf-8", newline="\n")
        print(out, out.stat().st_size, "bytes")
