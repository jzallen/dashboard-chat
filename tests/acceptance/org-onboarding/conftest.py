"""Fixtures for the org-onboarding acceptance suite.

WS strategy = C (real local / ``@real_io``): every adapter is real (the compose
stack). Scenarios skip — never fail — when the stack is unreachable, so a
no-stack run never blocks. They are RED (fail) when the stack is up and the
feature is unbuilt: the intended DISTILL posture.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
from urllib.parse import urlparse

import pytest
from driver import DEV_USER_EMAIL, DEV_USER_ID, OnboardingDriver

# The api compose service (docker-compose.yml: services.api). Its DB is SQLite
# local to the container — DATABASE_URL=sqlite+aiosqlite:////data/app.db.
_API_CONTAINER = "dashboard-api"
_API_DB_PATH = "/data/app.db"
_API_BASE_URL = "http://localhost:8000"


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


# ── empty-org janitor (UI-2) ─────────────────────────────────────────────────
def _docker_exec(*args: str, timeout: float = 10.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "exec", _API_CONTAINER, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _identity_headers(org_id: str) -> list[str]:
    """In-container identity headers (TRUST_PROXY_HEADERS=true).

    Under DEV_NO_ORG the x-org-id header is IGNORED by the backend (the S1
    feature) — org scoping comes from ``created_by`` resolution — so the curl
    calls work regardless of the header value.
    """
    return [
        "-H", f"x-user-id: {DEV_USER_ID}",
        "-H", f"x-org-id: {org_id}",
        "-H", f"x-user-email: {DEV_USER_EMAIL}",
    ]


def _owned_org_ids() -> list[str]:
    """Org ids with ``created_by == DEV_USER_ID`` — read DB-level in-container.

    Strictly scoped to dev-principal-owned rows: the seeded ``dev-org-001`` has
    ``created_by`` NULL and is never returned. Any failure (container down,
    table missing) parses as no orgs → the janitor is a no-op.
    """
    script = (
        "import json, sqlite3\n"
        f"con = sqlite3.connect({_API_DB_PATH!r})\n"
        "rows = con.execute(\n"
        f"    'SELECT id FROM organizations WHERE created_by = ?', ({DEV_USER_ID!r},)\n"
        ").fetchall()\n"
        "print(json.dumps([row[0] for row in rows]))\n"
    )
    proc = _docker_exec("python", "-c", script)
    try:
        ids = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(ids, list):
        return []
    return [str(org_id) for org_id in ids if org_id]


def _delete_projects_of_org(org_id: str) -> None:
    """Delete the org's projects through the PRODUCTION delete path.

    In-container curl with injected identity headers — respects the backend's
    FK-children/cascade logic instead of raw SQL. No-op when listing fails or
    the org has no projects.
    """
    list_proc = _docker_exec(
        "curl", "-s", f"{_API_BASE_URL}/api/projects", *_identity_headers(org_id)
    )
    try:
        body = json.loads(list_proc.stdout or "{}")
    except json.JSONDecodeError:
        return
    items = body.get("data", []) if isinstance(body, dict) else []
    for item in items:
        project_id = item.get("id") if isinstance(item, dict) else None
        if not project_id:
            continue
        _docker_exec(
            "curl", "-s", "-X", "DELETE",
            f"{_API_BASE_URL}/api/projects/{project_id}",
            *_identity_headers(org_id),
        )


def _delete_owned_orgs() -> None:
    """Delete organizations rows owned by the dev principal, DB-level.

    There is intentionally no DELETE /api/orgs endpoint (and none may be
    introduced), so the rows go via stdlib sqlite3 inside the api container.
    Scoped strictly to ``created_by == DEV_USER_ID``.
    """
    script = (
        "import sqlite3\n"
        f"con = sqlite3.connect({_API_DB_PATH!r})\n"
        f"con.execute('DELETE FROM organizations WHERE created_by = ?', ({DEV_USER_ID!r},))\n"
        "con.commit()\n"
        "con.close()\n"
    )
    _docker_exec("python", "-c", script)


@pytest.fixture()
def fresh_dev_principal(driver: OnboardingDriver, dev_jwt: str) -> str:
    """ENFORCE the empty-org precondition: the dev principal owns NO org.

    DEV_NO_ORG (slice S1) resolves org by ``created_by == dev-user-001``; a
    repeatable run needs that resolution to find nothing at the start. A
    test-only janitor (UI-2, closed) deletes the dev principal's owned orgs
    and their projects out-of-band via ``docker exec dashboard-api``,
    mirroring the sibling suite's ``clean_projects_for_dev_user``: projects go
    through the production DELETE path (in-container curl, identity headers);
    org rows go DB-level (stdlib sqlite3) because no org-delete API exists by
    design. The janitor is no-op-safe and never touches orgs not owned by the
    dev principal (the seeded ``dev-org-001`` has ``created_by`` NULL). After
    it runs, GET /api/orgs/me under DEV_NO_ORG returns 404, making the
    onboarding scenarios repeatable across consecutive suite runs against the
    same backend DB. Gated on the stack being reachable via ``dev_jwt`` →
    ``requires_compose_stack``.
    """
    owned_org_ids = _owned_org_ids()
    for org_id in owned_org_ids:
        _delete_projects_of_org(org_id)
    if owned_org_ids:
        _delete_owned_orgs()
    return dev_jwt
