#!/usr/bin/env python3
"""Render branding/*.svg into the PNG resources the APK uses (branding/res).

Rasterizes with headless Edge/Chrome at 4x, then downsizes with Pillow.
    python branding/render.py [--browser path/to/msedge.exe]
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "res"

# (svg, resource path, width, height)
TARGETS = [
    ("icon.svg", "mipmap-mdpi/ic_launcher.png", 80, 80),
    ("icon.svg", "mipmap-hdpi/ic_launcher.png", 120, 120),
    ("icon.svg", "mipmap-xhdpi/ic_launcher.png", 160, 160),
    ("icon.svg", "mipmap-xxhdpi/ic_launcher.png", 240, 240),
    ("icon.svg", "mipmap-xxxhdpi/ic_launcher.png", 320, 320),
    ("icon.svg", "mipmap-mdpi/ic_app.png", 48, 48),
    ("icon.svg", "mipmap-hdpi/ic_app.png", 72, 72),
    ("icon.svg", "mipmap-xhdpi/ic_app.png", 96, 96),
    ("banner.svg", "drawable/app_banner.png", 320, 180),
    ("banner.svg", "drawable-xhdpi/app_banner.png", 640, 360),
]

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "google-chrome", "chromium", "msedge",
]


def find_browser(explicit: str | None) -> str:
    for b in ([explicit] if explicit else []) + BROWSERS:
        if b and (Path(b).exists() or shutil.which(b)):
            return b
    raise SystemExit("no Edge/Chrome found; pass --browser")


def rasterize(browser: str, svg: Path, w: int, h: int, scale: int, tmp: Path) -> Image.Image:
    W, H = w * scale, h * scale
    html = tmp / f"{svg.stem}.html"
    html.write_text(
        "<!doctype html><html><head><style>html,body{margin:0;background:transparent}"
        f"img{{display:block;width:{W}px;height:{H}px}}</style></head>"
        f"<body><img src='{svg.as_uri()}'></body></html>",
        encoding="utf-8",
    )
    png = tmp / f"{svg.stem}-{W}.png"
    subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--default-background-color=00000000", "--allow-file-access-from-files",
                    f"--window-size={W},{H}", f"--screenshot={png}", html.as_uri()],
                   check=True, capture_output=True, timeout=60)
    return Image.open(png).convert("RGBA").crop((0, 0, W, H))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--browser")
    args = ap.parse_args()
    browser = find_browser(args.browser)
    shutil.rmtree(OUT, ignore_errors=True)
    cache: dict[tuple[str, float], Image.Image] = {}
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        for svg_name, rel, w, h in TARGETS:
            svg = HERE / svg_name
            # one big render per svg (aspect ratio), then downscale
            key = (svg_name, round(w / h, 3))
            if key not in cache:
                base_w, base_h = (512, 512) if w == h else (320, 180)
                cache[key] = rasterize(browser, svg, base_w, base_h, 4, tmp)
            img = cache[key].resize((w, h), Image.LANCZOS)
            dst = OUT / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            img.save(dst, optimize=True)
            print(f"{rel:38} {w}x{h}")


if __name__ == "__main__":
    main()
