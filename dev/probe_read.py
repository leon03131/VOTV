#!/usr/bin/env python3
"""Collect "probe <label>" JSON lines from the device log (chunked by the probe plugin).

    python dev/probe_read.py "el ytlr-player-actions-container" [--serial ...] [--out file.json]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("label")
    ap.add_argument("--serial")
    ap.add_argument("--out")
    args = ap.parse_args()
    cmd = ["adb"] + (["-s", args.serial] if args.serial else []) + ["logcat", "-d", "-s", "VOTV:*"]
    log = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    prefix = f"probe {args.label}"
    chunks, last = [], []
    for line in log.splitlines():
        i = line.find(prefix)
        if i < 0:
            continue
        rest = line[i + len(prefix):]
        m = re.match(r" \[(\d+)\] ", rest)
        if m:
            if m.group(1) == "0":
                last = []
            last.append(rest[m.end():])
            chunks = last
        else:
            chunks = [rest[1:]]
            last = []
    if not chunks:
        print("not found", file=sys.stderr)
        return 1
    data = json.loads("".join(chunks))
    text = json.dumps(data, ensure_ascii=False, indent=1)
    if args.out:
        open(args.out, "w", encoding="utf-8").write(text)
    sys.stdout.reconfigure(encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
