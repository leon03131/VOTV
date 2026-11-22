#!/usr/bin/env python3
"""Dev server: serves a freshly built bundle.js on every request.

    python dev/serve.py [--port 8080] [--include selftest]

Point the app at it (emulator reaches the PC as 10.0.2.2; a TV uses the PC's LAN IP):
    adb shell setprop debug.votv.dev http://10.0.2.2:8080      (off: setprop debug.votv.dev "")
Then restart the app: plugins come from this PC, no APK rebuild needed.

Also serves /echo (used by the self-test): answers with the request body, the method in
x-echo-method and the X-Test request header in x-echo-test.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "plugins"))
import bundle  # noqa: E402


def make_server(port: int, include: tuple[str, ...] = (), quiet: bool = False) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # keep-alive: the client closes when it has everything

        def log_message(self, fmt, *args):  # noqa: N802
            if not quiet:
                super().log_message(fmt, *args)

        def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            path = self.path.split("?")[0]
            if path == "/echo":
                self._echo(b"")
                return
            if path != "/bundle.js":
                self.send_error(404)
                return
            try:
                body = bundle.build(dev=True, include=include).encode("utf-8")
            except Exception as e:  # show build errors in the app log instead of a silent fallback
                print(f"bundle error: {e}", file=sys.stderr)
                msg = json.dumps(f"dev bundle failed: {e}")
                body = f"try{{VotHost.log('e',{msg})}}catch(e){{}}".encode()
            self._send(200, body, "application/javascript; charset=utf-8")

        def do_POST(self):  # noqa: N802
            if self.path.split("?")[0] != "/echo":
                self.send_error(404)
                return
            n = int(self.headers.get("Content-Length") or 0)
            self._echo(self.rfile.read(n))

        def _echo(self, body: bytes) -> None:
            self._send(200, body, self.headers.get("Content-Type") or "application/octet-stream",
                       {"x-echo-method": self.command, "x-echo-test": self.headers.get("X-Test") or ""})

    class Server(ThreadingHTTPServer):
        request_queue_size = 64  # default 5 drops parallel connections from the device
        daemon_threads = True

        def shutdown_request(self, request):
            # Lingering close. The Android emulator's network (slirp) loses the tail of a
            # response when a Windows server closes right after sending (~15 KB got through).
            try:
                request.shutdown(socket.SHUT_WR)
                request.settimeout(5)
                while request.recv(4096):
                    pass
            except OSError:
                pass
            self.close_request(request)

    return Server(("0.0.0.0", port), Handler)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--include", nargs="*", default=[], help="also bundle these plugins (e.g. selftest)")
    args = ap.parse_args()
    print(f"serving bundle.js on http://0.0.0.0:{args.port}")
    make_server(args.port, tuple(args.include)).serve_forever()
