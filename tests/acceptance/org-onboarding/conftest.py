"""Fixtures for the org-onboarding acceptance suite.

WS strategy = C (real local / ``@real_io``): every adapter is real (the compose
stack). Scenarios skip — never fail — when the stack is unreachable, so a
no-stack run never blocks. They are RED (fail) when the stack is up and the
feature is unbuilt: the intended DISTILL posture.
"""

from __future__ import annotations

import http.server
import json
import os
import socket
import subprocess
import threading
from collections.abc import Iterator
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


# ── in-suite fake WorkOS (TRANSITIONAL — retires with the re-verify at DELIVER) ─
# The shipped onboarding machine's `verifying` actor (ui-state getWorkOSUserInfo)
# re-verifies the Bearer against ${FAKE_WORKOS_URL}/oauth/userinfo
# unconditionally — non-200/unreachable → session_rejected. The compose
# dashboard-ui-state container defaults FAKE_WORKOS_URL to
# host.docker.internal:14299 (extra_hosts host-gateway already wired), so the
# suite self-provisions a loopback-fake on the host, mirroring the sibling TS
# suite's fake-workos.ts. Stdlib only (http.server + threading + json).
#
# client-driven-onboarding NOTE: ui-state loses ALL egress (ADR-048 §4) and the
# re-verify invoke RETIRES (ADR-049 D3) — the relocated fake-WorkOS seam moves to
# auth-proxy's WORKOS_BASE (R4), and AUTH_MODE=dev exercises no WorkOS at all. This
# fixture is kept for the DISTILL RED window so the CURRENT (pre-feature) stack's
# session_begin still settles instead of session_rejecting on an unreachable
# userinfo — keeping the reworked tests RED for the RIGHT reason (the new contract),
# not BROKEN by infrastructure. It already no-ops when the port is taken; once
# DELIVER removes the re-verify it becomes a harmless no-op and can be deleted.
_FAKE_WORKOS_BIND = ("0.0.0.0", 14299)
_FAKE_WORKOS_PROFILE = {"email": "dev@localhost", "name": "Dev User"}


class _FakeWorkOSHandler(http.server.BaseHTTPRequestHandler):
    """GET /oauth/userinfo → 200 dev profile. Any Bearer accepted."""

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler contract
        if self.path.split("?", 1)[0] != "/oauth/userinfo":
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(_FAKE_WORKOS_PROFILE).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        """Silence per-request stderr logging."""


@pytest.fixture(scope="session")
def fake_workos_userinfo() -> Iterator[None]:
    """Session-scoped fake-WorkOS userinfo endpoint on 0.0.0.0:14299.

    Lazy: only fixtures that drive session_begin (``dev_jwt`` /
    ``fresh_dev_principal``) depend on it, so a stack-down run that skips
    early never pays for it. NO-OP when port 14299 is already bound — an
    external fake-workos (e.g. the TS harness's) is running and serves the
    same contract. Daemon thread + non-blocking shutdown: no teardown hang.
    """
    try:
        server = http.server.ThreadingHTTPServer(_FAKE_WORKOS_BIND, _FakeWorkOSHandler)
    except OSError:
        yield  # port taken → an external fake-workos owns the contract
        return
    thread = threading.Thread(
        target=server.serve_forever, name="fake-workos-userinfo", daemon=True
    )
    thread.start()
    try:
        yield
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture()
def dev_jwt(
    requires_compose_stack: None,
    fake_workos_userinfo: None,
    driver: OnboardingDriver,
) -> str:
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
def fresh_dev_principal(
    driver: OnboardingDriver, dev_jwt: str, fake_workos_userinfo: None
) -> str:
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
