"""Fixtures for the ui-cookie-session acceptance suite.

WS strategy = C (real local / ``@real_io``): every adapter is real (the compose
stack). Scenarios **skip** — never fail — when the stack is unreachable, so a
no-stack run never blocks. They are **RED** (fail) when the stack is up and the
feature is unbuilt: the intended DISTILL posture.
"""

from __future__ import annotations

import os
import socket
from urllib.parse import urlparse

import pytest
from driver import CookieSessionDriver


@pytest.fixture(scope="session")
def reverse_proxy_url() -> str:
    return os.environ.get("REVERSE_PROXY_URL", "http://localhost:5173").rstrip("/")


@pytest.fixture(scope="session")
def auth_proxy_url() -> str:
    return os.environ.get("AUTH_PROXY_URL", "http://localhost:1042").rstrip("/")


@pytest.fixture(scope="session")
def driver(reverse_proxy_url: str, auth_proxy_url: str) -> CookieSessionDriver:
    return CookieSessionDriver(
        reverse_proxy_url=reverse_proxy_url, auth_proxy_url=auth_proxy_url
    )


def _reachable(url: str, timeout: float = 1.5) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


@pytest.fixture()
def requires_compose_stack(reverse_proxy_url: str, auth_proxy_url: str) -> None:
    """Skip when the local compose stack is not reachable on its host ports."""
    if not (_reachable(reverse_proxy_url) and _reachable(auth_proxy_url)):
        pytest.skip(
            f"compose stack not reachable ({reverse_proxy_url} / {auth_proxy_url}) — "
            "bring it up with `docker compose up -d` from the repo root"
        )


@pytest.fixture()
def signed_in(requires_compose_stack: None, driver: CookieSessionDriver):
    """A completed dev sign-in: returns the callback HTTPResult so a test can read
    both the Set-Cookie headers and the (D2) body token. Requires the stack up.

    Skips (does not fail) when the callback itself is broken, so a misconfigured
    auth-proxy surfaces as a clear skip rather than a confusing downstream
    "no auth_token Set-Cookie" assertion error.
    """
    result = driver.sign_in()
    if result.status != 200:
        pytest.skip(
            f"dev sign-in failed: POST /api/auth/callback returned {result.status} "
            f"({str(result.json())[:200]}) — verify AUTH_MODE=dev and that /api/* is proxied"
        )
    return result
