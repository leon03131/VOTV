"""Google services under a different signature.

1. Point GMS package/action strings at microG (like ReVanced "GmsCore support").
   Without microG installed the app simply finds no Google services.
2. Make the "are Google Play services available?" check ask microG.
   No microG -> "service missing" -> the app falls back to signing in with a
   code on yt.be/activate.
"""
from __future__ import annotations

import re

from . import Ctx, PatchError, replace_method_body

# Exact string constants to rename (same set as the reference build).
STRINGS = [
    "com.google.android.gms",
    "com.google.android.gms.ads.identifier.service.START",
    "com.google.android.gms.auth.api.phone.permission.SEND",
    "com.google.android.gms.chimera",
    "com.google.android.gms.clearcut.service.START",
    "com.google.android.gms.common.telemetry.service.START",
    "com.google.android.gms.droidguard.service.START",
    "com.google.android.gms.fonts",
    "com.google.android.gms.phenotype",
    "com.google.android.gms.phenotype.service.START",
    "com.google.android.gms.potokens.service.START",
    "com.google.android.gms.signin.service.START",
    "com.google.android.gsf.action.GET_GLS",
    "com.google.android.gsf.login",
    "com.google.android.mobstore.service.START",
    "com.google.android.providers.gsf.permission.READ_GSERVICES",
]

MANIFEST_PERMISSIONS = [
    "com.google.android.gms.permission.AD_ID",
    "com.google.android.providers.gsf.permission.READ_GSERVICES",
]


def _rename(s: str, microg: str) -> str:
    return microg[: -len(".gms")] + s[len("com.google.android"):]


def apply(ctx: Ctx) -> None:
    microg = ctx.cfg["microg_package"]  # app.revanced.android.gms
    pat = re.compile(r'(const-string(?:/jumbo)? [vp]\d+, )"(' + "|".join(re.escape(s) for s in STRINGS) + r')"')
    total = 0
    for p in ctx.smali_files():
        text = p.read_text(encoding="utf-8")
        if "com.google.android" not in text:
            continue
        new, n = pat.subn(lambda m: f'{m.group(1)}"{_rename(m.group(2), microg)}"', text)
        if n:
            p.write_text(new, encoding="utf-8", newline="\n")
            total += n
    if total < 30:
        raise PatchError(f"only {total} GMS strings renamed, expected ~47")
    ctx.note(f"smali: {total} GMS strings -> microG")

    mf = ctx.manifest()
    text = mf.read_text(encoding="utf-8")
    for perm in MANIFEST_PERMISSIONS:
        text = text.replace(f'"{perm}"', f'"{_rename(perm, microg)}"')
    mf.write_text(text, encoding="utf-8", newline="\n")

    # GoogleApiAvailability: the only class with the "gcore_" campaign string.
    hits = ctx.files_with('"gcore_"')
    if len(hits) != 1:
        raise PatchError(f'"gcore_" class: expected 1, got {len(hits)}')
    replace_method_body(
        hits[0],
        re.compile(r"^\.method public final \w+\(Landroid/content/Context;I\)I$"),
        """
    .locals 1
    invoke-static {p1}, Lapp/votv/host/Gms;->availability(Landroid/content/Context;)I
    move-result v0
    return v0
""",
    )
    ctx.note(f"availability check -> app.votv.host.Gms ({hits[0].stem})")
