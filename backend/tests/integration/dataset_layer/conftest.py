"""Conftest for the dataset-layer api-driven-user-flow-tests.

Per ``docs/evolution/2026-05-01-api-driven-user-flow-tests.md`` §4 Reuse
Analysis, this subtree explicitly does NOT use the moto-based S3 mock — the
Guiding Principle requires real MinIO from the compose stack. We therefore
override the parent ``backend/tests/integration/conftest.py`` autouse
``auto_mock_s3`` with a no-op so the integration mock does not bleed into
this subtree (the tests skip when compose is unavailable, but if a future
unit-style test lands here the parent autouse must not silently re-engage).

Fixtures:

* ``dataset_layer_env`` (session) — collects compose URLs (``AUTH_PROXY_URL``,
  ``AGENT_URL``) plus a backend-issued dev JWT from
  ``POST {auth-proxy}/api/auth/callback``. Skip-when-unavailable semantics
  mirror ``backend/tests/integration/test_lake_preview_live.py`` and the
  smoke probe at ``test_smoke_chat_cleaning.py``.
* ``dataset_layer_pat`` (session) — mints a PAT via
  ``POST {auth-proxy}/api/auth/pats`` to validate the headless-tokens flow
  end-to-end; revokes at session end. Skipped when ``M2M_ENABLED`` is not
  ``true`` on the auth-proxy.
* ``dataset_layer_project`` (function) — ULID-keyed per-test project; deleted
  in try/finally teardown. Cheap (~100ms create / ~1s delete) per
  design §8.

The test_smoke_chat_cleaning.py probe predates these fixtures and uses its
own narrower env shape (``AGENT_URL``/``BACKEND_URL`` direct, bypassing
auth-proxy). It is intentionally left untouched — the smoke probe is a
single-tool shape; this conftest hosts the full-workload fixtures.
"""

from __future__ import annotations

import contextlib
import os
import socket
from collections.abc import AsyncIterator
from urllib.parse import urlparse

import httpx
import pytest
import pytest_asyncio

from .harness import (
    fetch_dev_user_jwt,
    mint_pat,
    revoke_pat,
)

# ---------------------------------------------------------------------------
# Pin Groq temperature to 0 for harness determinism
# ---------------------------------------------------------------------------
# Per design.md §5, the dataset-layer suite needs deterministic LLM behavior so
# the retry-with-rephrase budget (≤2 per cleanup op) is sufficient under real
# Groq jitter. Production default is 0.3 (interpretive freedom for abstract
# user prompts); tests pin to 0.0. Set at import time so it lands before any
# subprocess that reads the agent's env (compose, in-process spawn, etc.)
# inherits it. We do NOT overwrite an explicit caller value — CI may pin a
# different temperature for a specific failure investigation.
os.environ.setdefault("GROQ_TEMPERATURE", "0.0")


# ---------------------------------------------------------------------------
# Override the parent integration autouse so this subtree never enters moto
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def auto_mock_s3():
    """No-op override of ``backend/tests/integration/conftest.py``'s autouse.

    Real MinIO is the SUT here; mocking S3 would silently violate the
    Guiding Principle.
    """
    yield None


# ---------------------------------------------------------------------------
# Service reachability
# ---------------------------------------------------------------------------


def _service_reachable(url: str, timeout: float = 0.5) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _env_or_default(name: str, default: str | None = None) -> str | None:
    val = os.environ.get(name)
    if val:
        return val.rstrip("/")
    return default


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="session")
async def dataset_layer_env() -> AsyncIterator[dict[str, str]]:
    """Resolve compose URLs + obtain a dev JWT, or skip the suite.

    Required env (defaults match the local published-port topology):
        AUTH_PROXY_URL  — e.g. http://localhost:3000
        AGENT_URL       — e.g. http://localhost:8787

    The dev JWT is fetched lazily via the callback endpoint; failure to
    reach the auth-proxy or to receive a token is also a skip (the suite
    can't run if the SUT isn't up).
    """
    auth_proxy_url = _env_or_default("AUTH_PROXY_URL", "http://localhost:3000")
    agent_url = _env_or_default("AGENT_URL", "http://localhost:8787")
    assert auth_proxy_url and agent_url  # type-narrowing; defaults guarantee non-None

    if not _service_reachable(auth_proxy_url):
        pytest.skip(f"auth-proxy not reachable at {auth_proxy_url}")
    if not _service_reachable(agent_url):
        pytest.skip(f"agent (worker) not reachable at {agent_url}")

    try:
        user_jwt = await fetch_dev_user_jwt(auth_proxy_url)
    except (httpx.HTTPError, RuntimeError) as e:
        pytest.skip(f"could not obtain dev JWT from {auth_proxy_url}/api/auth/callback: {e}")

    yield {
        "auth_proxy_url": auth_proxy_url,
        "agent_url": agent_url,
        "user_jwt": user_jwt,
    }


@pytest_asyncio.fixture(scope="session")
async def dataset_layer_pat(dataset_layer_env: dict[str, str]) -> AsyncIterator[str]:
    """Mint a PAT for the suite; revoke on teardown.

    Validates ``docs/guides/headless-tokens.md`` end-to-end. Skipped when
    auth-proxy returns 404 (``M2M_ENABLED`` unset) or any other non-2xx —
    those are signals that the issuance flow is not configured, not bugs
    this suite should fail on.
    """
    auth_proxy_url = dataset_layer_env["auth_proxy_url"]
    user_jwt = dataset_layer_env["user_jwt"]
    try:
        pat_id, token = await mint_pat(auth_proxy_url, user_jwt)
    except (httpx.HTTPError, RuntimeError) as e:
        pytest.skip(f"PAT issuance unavailable at {auth_proxy_url}/api/auth/pats: {e}")

    try:
        yield token
    finally:
        # Best-effort: a revoke failure during teardown is not a test failure.
        with contextlib.suppress(httpx.HTTPError):
            await revoke_pat(auth_proxy_url, user_jwt, pat_id)


# ---------------------------------------------------------------------------
# Per-test project fixture (function scope)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def dataset_layer_project(
    dataset_layer_env: dict[str, str],
) -> AsyncIterator[str]:
    """Create a ULID-keyed project, delete in try/finally per design §8."""
    from .harness import _new_ulid_suffix  # private helper, scoped to tests

    auth_proxy_url = dataset_layer_env["auth_proxy_url"]
    user_jwt = dataset_layer_env["user_jwt"]
    name = f"dataset-staging-{_new_ulid_suffix()}"
    project_id: str | None = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            f"{auth_proxy_url}/api/projects",
            headers={
                "Authorization": f"Bearer {user_jwt}",
                "Content-Type": "application/json",
            },
            json={"name": name},
        )
        res.raise_for_status()
        body = res.json()
        project_id = (body.get("data") or body).get("id")
        if not isinstance(project_id, str):
            raise RuntimeError(f"create_project did not return an id: {body!r}")

        try:
            yield project_id
        finally:
            # Belt-and-suspenders: tests crashing mid-run shouldn't break teardown.
            with contextlib.suppress(httpx.HTTPError):
                await client.delete(
                    f"{auth_proxy_url}/api/projects/{project_id}",
                    headers={"Authorization": f"Bearer {user_jwt}"},
                )
