#!/usr/bin/env python3
"""votv build: original YouTube for Android TV APKs -> patched, signed APKs.

Quick start:
  1. Put original YouTube for Android TV (8.02.300) APK(s) into ./input/
  2. Run: python build/build.py   (or build.bat on Windows / ./build.sh on Linux/macOS)

Needs: Python 3.10+, Node 20+, Java 17+, Android SDK (build-tools 35+, platforms).
apktool.jar, plugin bundle dependencies, and a local signing keystore are handled automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from patches import Ctx, PatchError  # noqa: E402
from patches import branding, client_id, gms, host_bridge, package_name, primes  # noqa: E402

sys.path.insert(0, str(ROOT / "plugins"))
import bundle as plugin_bundle  # noqa: E402

PATCHES = [package_name, gms, client_id, primes, branding, host_bridge]
ABI_DIRS = {"arm": "armeabi-v7a", "arm64": "arm64-v8a", "x86": "x86", "x86_64": "x86_64"}
APKTOOL_VERSION = "2.12.1"
APKTOOL_URL = f"https://github.com/iBotPeaches/Apktool/releases/download/v{APKTOOL_VERSION}/apktool_{APKTOOL_VERSION}.jar"
EXE = ".exe" if os.name == "nt" else ""
BAT = ".bat" if os.name == "nt" else ""
NPM = "npm.cmd" if os.name == "nt" else "npm"


def run(cmd: list, **kw) -> str:
    print("  $", " ".join(str(c) for c in cmd[:6]), "..." if len(cmd) > 6 else "")
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.stderr.write(r.stdout[-4000:] + r.stderr[-4000:])
        raise SystemExit(f"command failed: {cmd[0]}")
    return r.stdout


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _version_key(p: Path) -> tuple:
    return tuple(int(x) if x.isdigit() else -1 for x in re.split(r"[.\-]", p.name.replace("android-", "")))


def detect_sdk(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(explicit)
    for env in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        v = os.environ.get(env)
        if v:
            candidates.append(Path(v))
    if os.environ.get("LOCALAPPDATA"):
        candidates.append(Path(os.environ["LOCALAPPDATA"]) / "Android" / "Sdk")
    candidates.extend([
        Path.home() / "Android" / "Sdk",
        Path.home() / "Library" / "Android" / "sdk",
    ])
    for c in candidates:
        if (c / "build-tools").is_dir() and (c / "platforms").is_dir():
            return c
    raise SystemExit(
        "Android SDK not found. Install Android SDK (build-tools 35+ & platforms) "
        "and set ANDROID_HOME, or pass --sdk <path>."
    )


class Sdk:
    def __init__(self, home: Path):
        tools = [p for p in (home / "build-tools").iterdir() if p.is_dir()]
        if not tools:
            raise SystemExit(f"no build-tools found under {home / 'build-tools'}")
        bt = max(tools, key=_version_key)
        if _version_key(bt)[0] < 35:
            # d8 from build-tools 34 crashes on classes compiled by JDK 21's javac.
            raise SystemExit(f"need Android build-tools 35+ (found {bt.name}): "
                             'sdkmanager "build-tools;36.0.0"')
        self.aapt2 = bt / f"aapt2{EXE}"
        self.d8 = bt / f"d8{BAT}"
        self.zipalign = bt / f"zipalign{EXE}"
        self.apksigner = bt / f"apksigner{BAT}"
        plats = list((home / "platforms").glob("android-*/android.jar"))
        if not plats:
            raise SystemExit(f"no android.jar found under {home / 'platforms'}")
        self.android_jar = max(plats, key=lambda j: _version_key(j.parent))


def ensure_apktool(explicit: Path | None) -> Path:
    if explicit:
        if not explicit.is_file():
            raise SystemExit(f"apktool not found: {explicit}")
        return explicit
    for p in (ROOT / "tools" / "apktool.jar", ROOT.parent / "tools" / "apktool.jar"):
        if p.is_file():
            return p
    dest = ROOT / "tools" / "apktool.jar"
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[setup] downloading apktool {APKTOOL_VERSION} -> {dest}")
    tmp = dest.with_suffix(".jar.tmp")
    try:
        urllib.request.urlretrieve(APKTOOL_URL, tmp)
        tmp.replace(dest)
    except Exception as e:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"failed to download apktool from {APKTOOL_URL}: {e}")
    return dest


def ensure_keystore(ks_arg: Path | None, pass_arg: Path | None) -> tuple[Path, str]:
    if ks_arg:
        ks = ks_arg
        pw_file = pass_arg or ks.with_suffix(".pass")
        if not ks.is_file():
            raise SystemExit(f"keystore not found: {ks}")
        if not pw_file.is_file():
            raise SystemExit(f"keystore password file not found: {pw_file}")
        return ks, pw_file.read_text(encoding="utf-8").strip()

    for ks_dir in (ROOT / "keys", ROOT.parent / "keys"):
        ks = ks_dir / "votv.jks"
        pw_file = pass_arg or (ks_dir / "votv.pass")
        if ks.is_file() and pw_file.is_file():
            return ks, pw_file.read_text(encoding="utf-8").strip()

    ks_dir = ROOT / "keys"
    ks_dir.mkdir(parents=True, exist_ok=True)
    ks = ks_dir / "votv.jks"
    pw_file = ks_dir / "votv.pass"
    password = secrets.token_urlsafe(24)
    print(f"[setup] generating local signing keystore -> {ks}")
    run([
        "keytool", "-genkeypair",
        "-keystore", ks,
        "-alias", "votv",
        "-keyalg", "RSA", "-keysize", "4096",
        "-validity", "36500",
        "-dname", "CN=VOTV",
        "-storepass", password,
        "-keypass", password,
    ])
    pw_file.write_text(password + "\n", encoding="utf-8")
    return ks, password


def ensure_plugins_built() -> None:
    vot_dist = ROOT / "plugins" / "vot" / "dist" / "vot.js"
    if vot_dist.is_file():
        return
    print("[setup] building @vot.js translation plugin")
    if not (ROOT / "node_modules").is_dir():
        cmd = [NPM, "ci" if (ROOT / "package-lock.json").is_file() else "install"]
        run(cmd, cwd=ROOT)
    run([NPM, "run", "build:vot"], cwd=ROOT)


def badging(sdk: Sdk, apk: Path) -> dict:
    out = run([sdk.aapt2, "dump", "badging", apk])
    pkg = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", out)
    native = re.search(r"native-code: (.+)", out)
    abis = re.findall(r"'([^']+)'", native.group(1)) if native else []
    return {"package": pkg.group(1), "code": int(pkg.group(2)), "name": pkg.group(3), "abis": abis}


def find_inputs(sdk: Sdk, folder: Path, cfg: dict, wanted: list[str] | None) -> dict[str, tuple[Path, dict]]:
    if not folder.is_dir():
        raise SystemExit(
            f"input directory does not exist: {folder}\n"
            f"Put original {cfg['original_package']} ({cfg['original_version']}) APK(s) into {ROOT / 'input'} "
            f"or pass --input <dir>."
        )
    found = {}
    for apk in sorted(folder.glob("*.apk")):
        try:
            info = badging(sdk, apk)
        except SystemExit:
            continue
        if info["package"] != cfg["original_package"] or info["name"] != cfg["original_version"]:
            continue
        if len(info["abis"]) != 1:
            continue
        abi = next((k for k, v in ABI_DIRS.items() if v == info["abis"][0]), None)
        if abi and (wanted is None or abi in wanted):
            found[abi] = (apk, info)
    if wanted is None:
        if not found:
            raise SystemExit(
                f"no {cfg['original_package']} {cfg['original_version']} APKs found in {folder}\n"
                f"Place one or more single-ABI YouTube for Android TV {cfg['original_version']} APK(s) "
                f"(arm / arm64 / x86) into {folder} and try again."
            )
        return found
    missing = [a for a in wanted if a not in found]
    if missing:
        raise SystemExit(f"no {cfg['original_package']} {cfg['original_version']} APK in {folder} for: {', '.join(missing)}")
    return found


def dex_signature(apk: Path) -> str:
    with zipfile.ZipFile(apk) as z:
        names = sorted(n for n in z.namelist() if re.fullmatch(r"classes\d*\.dex|resources\.arsc", n))
        return hashlib.sha1(b"".join(hashlib.sha1(z.read(n)).digest() for n in names)).hexdigest()


def build_host(sdk: Sdk, work: Path) -> Path:
    src = ROOT / "host" / "src"
    out = work / "host"
    shutil.rmtree(out, ignore_errors=True)
    (out / "classes").mkdir(parents=True)
    files = [str(p) for p in src.rglob("*.java")]
    run(["javac", "-source", "8", "-target", "8", "-Xlint:-options", "-encoding", "UTF-8",
         "-bootclasspath", sdk.android_jar, "-d", out / "classes", *files])
    classes = [str(p) for p in (out / "classes").rglob("*.class")]
    run([sdk.d8, "--release", "--min-api", "24", "--lib", sdk.android_jar, "--output", out, *classes])
    return out / "classes.dex"


def main() -> None:
    cfg = json.loads((ROOT / "build" / "config.json").read_text(encoding="utf-8"))
    ap = argparse.ArgumentParser(description="Build VOTV APKs from original YouTube for Android TV APKs.")
    ap.add_argument("--input", type=Path, default=ROOT / "input",
                    help="folder with original YouTube TV APKs (default: ./input)")
    ap.add_argument("--abi", nargs="+", default=None, choices=list(ABI_DIRS),
                    help="ABIs to build (default: auto-detect all matching APKs in --input)")
    ap.add_argument("--apktool", type=Path, default=None, help="path to apktool.jar (auto-downloaded if missing)")
    ap.add_argument("--sdk", type=Path, default=None, help="path to Android SDK")
    ap.add_argument("--keystore", type=Path, default=None, help="path to .jks signing keystore")
    ap.add_argument("--keypass-file", type=Path, default=None, help="path to keystore password file")
    ap.add_argument("--out", type=Path, default=ROOT / "dist", help="output directory (default: ./dist)")
    args = ap.parse_args()

    sdk = Sdk(detect_sdk(args.sdk))
    apktool = ensure_apktool(args.apktool)
    ensure_plugins_built()
    work = ROOT / "work"
    work.mkdir(exist_ok=True)
    args.out.mkdir(exist_ok=True)

    print("[1/5] inputs")
    inputs = find_inputs(sdk, args.input, cfg, args.abi)
    sigs = {dex_signature(apk) for apk, _ in inputs.values()}
    if len(sigs) != 1:
        raise SystemExit("input APKs differ in code/resources; they must be the same build")
    for abi, (apk, info) in inputs.items():
        print(f"  {abi:7} {apk.name}  versionCode={info['code']}")

    print("[2/5] decode")
    base_apk = next(iter(inputs.values()))[0]
    decoded = work / "decoded"
    stamp = decoded / ".votv-source"
    if not (stamp.exists() and stamp.read_text() == sigs.copy().pop()):
        shutil.rmtree(decoded, ignore_errors=True)
        run(["java", "-jar", apktool, "d", "-f", "-o", decoded, base_apk])
        stamp.write_text(sigs.copy().pop())
    else:
        print("  cached")

    print("[3/5] patch")
    bundle_js = work / "bundle.js"
    try:
        bundle_js.write_text(plugin_bundle.build(), encoding="utf-8", newline="\n")
    except plugin_bundle.BundleError as e:
        raise SystemExit(str(e))
    cfg["_bundle"] = str(bundle_js)
    patched = work / "patched"
    shutil.rmtree(patched, ignore_errors=True)
    shutil.copytree(decoded, patched, ignore=shutil.ignore_patterns(".votv-source"))
    ctx = Ctx(root=patched, cfg=cfg)
    for p in PATCHES:
        print(f" {p.__name__.split('.')[-1]}")
        try:
            p.apply(ctx)
        except PatchError as e:
            raise SystemExit(f"patch {p.__name__} failed: {e}")

    print("[4/5] host")
    host_dex = build_host(sdk, work)

    print("[5/5] build per ABI")
    keystore, password = ensure_keystore(args.keystore, args.keypass_file)
    yml = patched / "apktool.yml"
    yml_text = yml.read_text(encoding="utf-8")
    results = []
    for abi, (apk, info) in inputs.items():
        print(f" {abi}")
        lib = patched / "lib"
        shutil.rmtree(lib, ignore_errors=True)
        with zipfile.ZipFile(apk) as z:
            for n in z.namelist():
                if n.startswith("lib/"):
                    z.extract(n, patched)
        yml.write_text(re.sub(r"versionCode: \d+", f"versionCode: {info['code']}", yml_text), encoding="utf-8", newline="\n")

        unsigned = work / f"unsigned-{abi}.apk"
        run(["java", "-jar", apktool, "b", "-o", unsigned, patched])

        # Add the host as one more dex file.
        with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as z:
            n = len([x for x in z.namelist() if re.fullmatch(r"classes\d*\.dex", x)])
            z.write(host_dex, f"classes{n + 1}.dex")

        aligned = work / f"aligned-{abi}.apk"
        run([sdk.zipalign, "-p", "-f", "4", unsigned, aligned])
        final = args.out / f"votv-{cfg['version_name']}-{abi}.apk"
        run([sdk.apksigner, "sign", "--ks", keystore, "--ks-pass", "env:VOTV_KS_PASS",
             "--ks-key-alias", "votv", "--out", final, aligned],
            env={**os.environ, "VOTV_KS_PASS": password})
        run([sdk.apksigner, "verify", final])
        Path(str(final) + ".idsig").unlink(missing_ok=True)
        results.append(final)

    print("\ndone:")
    for f in results:
        print(f"  {f}  {f.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
