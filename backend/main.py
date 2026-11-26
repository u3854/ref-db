"""CLI and application launcher for ref-db."""

from __future__ import annotations

import threading
import time
import urllib.error
import urllib.request
import webbrowser

import uvicorn

from backend.config import settings


def _open_browser_when_ready(
    url: str,
    stop_event: threading.Event,
    timeout_seconds: float = 120.0,
) -> None:
    """Wait until the FastAPI server responds on /api/health before opening the browser."""
    health_url = f"{url}/api/health"
    deadline = time.monotonic() + timeout_seconds
    while not stop_event.is_set() and time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(health_url, timeout=0.5) as resp:
                if resp.status == 200:
                    webbrowser.open(url)
                    return
        except (urllib.error.URLError, OSError):
            pass
        stop_event.wait(0.25)


def run(open_browser: bool = True) -> None:
    settings.ensure_dirs_and_env()
    url = f"http://{settings.host}:{settings.port}"
    stop_event = threading.Event()
    if open_browser:
        threading.Thread(
            target=_open_browser_when_ready,
            args=(url, stop_event),
            daemon=True,
        ).start()
    try:
        uvicorn.run(
            "backend.api:app",
            host=settings.host,
            port=settings.port,
            log_level="info",
            timeout_graceful_shutdown=2,
        )
    finally:
        stop_event.set()


if __name__ == "__main__":
    run()
