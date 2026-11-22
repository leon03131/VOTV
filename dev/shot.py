#!/usr/bin/env python3
"""Screenshot of the device screen as PNG (some TVs print a line before the PNG data).

    python dev/shot.py out.png [--serial 192.168.31.189:5555]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--serial")
    args = ap.parse_args()
    cmd = ["adb"] + (["-s", args.serial] if args.serial else []) + ["exec-out", "screencap", "-p"]
    data = subprocess.run(cmd, capture_output=True).stdout
    start = data.find(b"\x89PNG")
    if start < 0:
        print("no PNG in screencap output", file=sys.stderr)
        return 1
    args.out.write_bytes(data[start:])
    print(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
