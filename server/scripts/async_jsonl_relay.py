#!/usr/bin/env python3
"""Local relay service for fetching Baidu async OCR JSONL result URLs.

This avoids signature mismatch issues observed in Bob plugin runtime by proxying
jsonUrl downloads through native Python urllib on localhost.
"""

from __future__ import annotations

import argparse
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Final
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

ALLOWED_HOST_SUFFIXES: Final[tuple[str, ...]] = (
    "bcebos.com",
    "baidubce.com",
    "aistudio-app.com",
)


class RelayHandler(BaseHTTPRequestHandler):
    server_version = "JKLLMOCRRelay/0.1"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self._send_json(200, {"status": "ok"})
            return

        if parsed.path != "/fetch-jsonl":
            self._send_text(404, "not found")
            return

        query = parse_qs(parsed.query, keep_blank_values=False)
        raw_url = ""
        response_format = "text"
        if "url" in query and query["url"]:
            raw_url = query["url"][0].strip()
        if "format" in query and query["format"]:
            response_format = query["format"][0].strip().lower()

        if not raw_url:
            self._send_json(400, {"error": "missing url query"})
            return

        if len(raw_url) > 4096:
            self._send_json(400, {"error": "url too long"})
            return

        target = urlparse(raw_url)
        if target.scheme not in ("http", "https"):
            self._send_json(400, {"error": "unsupported url scheme"})
            return

        hostname = (target.hostname or "").lower()
        if not self._is_allowed_host(hostname):
            self._send_json(403, {"error": f"host not allowed: {hostname}"})
            return

        timeout_sec = getattr(self.server, "fetch_timeout", 45)
        request = Request(
            raw_url,
            method="GET",
            headers={
                "User-Agent": "JK-LLM-OCR-Local-Relay/0.1",
                "Accept": "application/json,text/plain,*/*",
            },
        )

        try:
            with urlopen(request, timeout=timeout_sec) as response:
                body = response.read()
                if response_format == "json":
                    text = body.decode("utf-8", errors="replace")
                    self._send_json(
                        200,
                        {
                            "ok": True,
                            "url": raw_url,
                            "size": len(body),
                            "text": text,
                        },
                    )
                    return
                self._send_bytes(200, body, "text/plain; charset=utf-8")
        except HTTPError as error:
            body = error.read()
            # Keep upstream status/body to aid debugging.
            if response_format == "json":
                detail = ""
                try:
                    detail = body.decode("utf-8", errors="replace")
                except Exception:
                    detail = repr(body[:200])
                self._send_json(error.code, {"error": "upstream http error", "detail": detail})
                return
            self._send_bytes(error.code, body, "text/plain; charset=utf-8")
        except (URLError, TimeoutError, socket.timeout) as error:
            self._send_json(
                502,
                {
                    "error": "relay fetch failed",
                    "detail": str(error),
                },
            )

    def log_message(self, fmt: str, *args: object) -> None:
        # Use standard stderr log format with remote address + path
        super().log_message(fmt, *args)

    def _is_allowed_host(self, hostname: str) -> bool:
        if not hostname:
            return False
        for suffix in ALLOWED_HOST_SUFFIXES:
            if hostname == suffix or hostname.endswith("." + suffix):
                return True
        return False

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_bytes(status, body, "application/json; charset=utf-8")

    def _send_text(self, status: int, text: str) -> None:
        self._send_bytes(status, text.encode("utf-8"), "text/plain; charset=utf-8")

    def _send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="JK-LLM-OCR local relay for async JSONL downloads")
    parser.add_argument("--host", default="127.0.0.1", help="listen host")
    parser.add_argument("--port", type=int, default=50123, help="listen port")
    parser.add_argument("--timeout", type=int, default=45, help="upstream fetch timeout seconds")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), RelayHandler)
    server.fetch_timeout = max(5, min(args.timeout, 300))
    print(
        f"[relay] listening on http://{args.host}:{args.port} "
        f"(timeout={server.fetch_timeout}s)",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
