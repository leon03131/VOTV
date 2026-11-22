"""Our own launcher icon, logo and Android TV banner."""
from __future__ import annotations

import shutil
from pathlib import Path

from . import Ctx, PatchError

BRANDING = Path(__file__).resolve().parent.parent / "branding" / "res"


def apply(ctx: Ctx) -> None:
    if not BRANDING.exists():
        raise PatchError("branding/res missing: run branding/render.py")
    n = 0
    for src in BRANDING.rglob("*.png"):
        rel = src.relative_to(BRANDING)
        dst = ctx.root / "res" / rel
        if not dst.exists():
            # A new density variant is fine if the resource itself exists.
            kind = rel.parts[0].split("-")[0]  # drawable / mipmap
            if not any((ctx.root / "res").glob(f"{kind}*/{src.name}")):
                raise PatchError(f"no such resource in APK: res/{rel}")
            dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        n += 1
    ctx.note(f"branding: {n} images replaced")
