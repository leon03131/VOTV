#!/usr/bin/env python3
"""End-to-end test on a connected device or emulator.

Serves a dev bundle with the `selftest` plugin, points the app at it (debug.votv.dev),
restarts the app and waits for "selftest PASS n/n" / "selftest FAIL" in logcat.

    python dev/e2e.py [--apk dist/votv-...-x86.apk] [--serial emulator-5554] [--host-ip 192.168.1.10]

Exit code 0 on PASS. Restores the previous debug.votv.dev value afterwards.
"""
from __future__ import annotations

import argparse
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import serve  # noqa: E402

PKG = "app.votv.youtube"


def adb(serial: str | None, *args: str, check: bool = True) -> str:
    cmd = ["adb"] + (["-s", serial] if serial else []) + list(args)
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        raise SystemExit(f"adb {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def lan_ip(device_ip: str | None) -> str:
    """This PC's address on the route to the device (not a WSL/Docker virtual adapter)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((device_ip or "10.255.255.255", 1))
        return s.getsockname()[0]
    finally:
        s.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk", type=Path, help="install this APK first")
    ap.add_argument("--serial")
    ap.add_argument("--port", type=int, default=8091)
    ap.add_argument("--host-ip", help="PC address as seen from the device (default: 10.0.2.2 on emulators, else LAN IP)")
    ap.add_argument("--timeout", type=int, default=120)
    args = ap.parse_args()

    if args.apk:
        print("install", args.apk.name)
        out = adb(args.serial, "install", "-r", str(args.apk))
        if "Success" not in out:
            raise SystemExit(out)

    emulator = adb(args.serial, "shell", "getprop", "ro.kernel.qemu").strip() == "1" or \
        (args.serial or "").startswith("emulator-")
    device_ip = (args.serial or "").split(":")[0] if re.match(r"^\d+\.\d+\.\d+\.\d+", args.serial or "") else None
    host = args.host_ip or ("10.0.2.2" if emulator else lan_ip(device_ip))
    url = f"http://{host}:{args.port}"

    server = serve.make_server(args.port, include=("selftest",), quiet=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    previous = adb(args.serial, "shell", "getprop", "debug.votv.dev").strip()
    try:
        adb(args.serial, "shell", "setprop", "debug.votv.dev", url)
        adb(args.serial, "shell", "am", "force-stop", PKG)
        adb(args.serial, "logcat", "-c")
        adb(args.serial, "shell", "monkey", "-p", PKG, "-c", "android.intent.category.LEANBACK_LAUNCHER", "1")
        print(f"app started, dev server {url}, waiting for selftest...")

        seen = 0
        deadline = time.time() + args.timeout
        verdict = None
        while time.time() < deadline and verdict is None:
            time.sleep(2)
            lines = adb(args.serial, "logcat", "-d", "-s", "VOTV:*", "AndroidRuntime:E").splitlines()
            for line in lines[seen:]:
                if "selftest" in line or "FATAL" in line or "failed" in line or "dev server" in line:
                    print("  " + line.split(": ", 1)[-1])
                if "using the plugins shipped in the APK" in line:
                    print("dev bundle not loaded: the device could not fetch it from this PC")
                    verdict = "NO-DEV-BUNDLE"
                m = re.search(r"selftest (PASS|FAIL) (\d+/\d+)", line)
                if m:
                    verdict = m.group(1)
                if "FATAL EXCEPTION" in line:
                    verdict = "CRASH"
            seen = len(lines)
        if verdict is None:
            print("no selftest result (timeout) - is the dev server reachable from the device?")
            return 2
        print("RESULT:", verdict)
        return 0 if verdict == "PASS" else 1
    finally:
        adb(args.serial, "shell", "setprop", "debug.votv.dev", previous or '""', check=False)
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
