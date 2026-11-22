"""Install next to the original app: new package name, label, process names."""
from __future__ import annotations

import re

from . import Ctx, PatchError


def apply(ctx: Ctx) -> None:
    old = ctx.cfg["original_package"]
    new = ctx.cfg["package"]
    mf = ctx.manifest()
    text = mf.read_text(encoding="utf-8")

    if f'package="{old}"' not in text:
        raise PatchError(f"manifest package is not {old}")

    # Every value that is exactly the old package or starts with "old." :
    # package attr, custom permission, taskAffinity, process names.
    # Java class names (com.google.android.apps.youtube.tv...) don't match.
    pattern = re.compile(r'"' + re.escape(old) + r'(\.[A-Za-z0-9_.]+)?"')
    text, n = pattern.subn(lambda m: f'"{new}{m.group(1) or ""}"', text)
    ctx.note(f"manifest: {n} package-prefixed values -> {new}")

    # Launcher label (application + any activity using the same string).
    label = ctx.cfg["label"]
    text, n = re.subn(r'android:label="@string/app_name"', f'android:label="{label}"', text)
    if n == 0:
        raise PatchError("app label not found")
    ctx.note(f"manifest: label -> {label} ({n}x)")

    # Let the app see microG (Android 11+ package visibility).
    microg = ctx.cfg["microg_package"]
    if microg not in text:
        text = text.replace("<queries>", f'<queries>\n        <package android:name="{microg}"/>', 1)

    mf.write_text(text, encoding="utf-8", newline="\n")

    # versionName shown in Android settings.
    yml = ctx.root / "apktool.yml"
    y = yml.read_text(encoding="utf-8")
    y, n = re.subn(r"(versionName: )(\S+)", lambda m: m.group(1) + ctx.cfg["version_name"], y)
    if n != 1:
        raise PatchError("versionName not found in apktool.yml")
    yml.write_text(y, encoding="utf-8", newline="\n")
    ctx.note(f"versionName -> {ctx.cfg['version_name']}")
