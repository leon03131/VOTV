"""Primes (Google performance library) crashes non-Google packages.

CrashOnBadPrimesConfiguration throws IllegalStateException("Primes init triggered from
background in package: ...") unless the package is on a hardcoded list of Google apps.
With our package name that list check fails, so a background start (boot receiver,
recommendations service) could crash the app. Make the check always pass.

Found by its allowlist: the class holding both "com.google.android.youtube.tv" and
"com.google.android.youtube.tvunplugged" string constants.
"""
from __future__ import annotations

import re

from . import Ctx, PatchError, replace_method_body


def apply(ctx: Ctx) -> None:
    hits = [p for p in ctx.files_with('"com.google.android.youtube.tvunplugged"')
            if '"com.android.vending"' in p.read_text(encoding="utf-8")]
    if len(hits) != 1:
        raise PatchError(f"Primes allowlist class: expected 1, got {len(hits)}")
    replace_method_body(
        hits[0],
        re.compile(r"^\.method public final \w+\(\)Z$"),
        """
    .locals 1
    const/4 v0, 0x1
    return v0
""",
    )
    ctx.note(f"Primes package allowlist -> always allowed ({hits[0].stem})")
