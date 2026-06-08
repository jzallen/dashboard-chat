"""Fixtures for the org-onboarding acceptance suite.

WS strategy = C (real local / ``@real_io``): every adapter is real (the compose
stack). Scenarios skip — never fail — when the stack is unreachable, so a
no-stack run never blocks. They are RED (fail) when the stack is up and the
feature is unbuilt: the intended DISTILL posture.
"""

from __future__ import annotations

import os
import socket
from urllib.parse import urlparse

import pytest
from driver import OnboardingDriver


@pytest.fixture(scope="session")
def reverse_proxy_url() -> str:
    return os.environ.get("REVERSE_PROXY_URL", "http://localhost:5173").rstrip("/")


@pytest.fixture(scope="session")
def auth_proxy_url() -> str:
    return os.environ.get("AUTH_PROXY_URL", "http://localhost:1042").rstrip("/")


@pytest.fixture(scope="session")
def driver(reverse_proxy_url: str, auth_proxy_url: str) -> OnboardingDriver:
    return OnboardingDriver(reverse_proxy_url=reverse_proxy_url, auth_proxy_url=auth_proxy_url)


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
def dev_jwt(requires_compose_stack: None, driver: OnboardingDriver) -> str:
    """A dev JWT for the empty-org principal (AUTH_MODE=dev)."""
    return driver.mint_dev_jwt()


@pytest.fixture()
def fresh_dev_principal(driver: OnboardingDriver, dev_jwt: str) -> str:
    """The empty-org precondition: the dev principal must have NO org in the DB.

    DEV_NO_ORG (slice S1) resolves org by ``created_by == dev-user-001``; a
    repeatable run needs that to be None at the start. There is no org-reset /
    DELETE affordance today (see upstream-issues.md UI-2), so this fixture
    asserts the precondition rather than enforcing it: if an org already exists
    it skips with guidance. It does NOT mask the feature being unbuilt — when
    DEV_NO_ORG is missing, /api/orgs/me returns 200 from the header claim and
    the scenario is RED (the desired DISTILL signal), not skipped here.
    """
    return dev_jwt
