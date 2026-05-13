"""Pytest configuration for the J-002 (`project-and-chat-session-management`) acceptance suite.

Strategy C (DD-2): drive the real local compose stack when reachable; skip
cleanly otherwise. Most scenarios are HTTP probes against `reverse-proxy`
(host port 5173) and `auth-proxy` (host port 1042), composed via the
`J002Driver`. A subset exercise the TS UserFlowHarness via subprocess
(`harness.j002.*`); those are gated by `requires_ts_harness`.

Every scenario in this suite is `pytest.mark.skip(...)`-marked at DISTILL
handoff. DELIVER's per-MR action (per `docs/feature/project-and-chat-session-management/distill/roadmap.json`)
is to remove the skip from the listed scenarios when the MR lands.

The `--auto` test selector falls through to `--backend` for changes that
touch this directory (the path is not in the docs allowlist). The skip
markers keep the gate GREEN on docs-shaped MRs.
"""

from __future__ import annotations

import os
import shutil
import socket
import sys
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from driver import J002Driver  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]


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


@pytest.fixture(scope="session")
def repo_root() -> Path:
    """Absolute path to the repo working tree root."""
    return REPO_ROOT


@pytest.fixture(scope="session")
def reverse_proxy_url() -> str:
    return os.environ.get("REVERSE_PROXY_URL", "http://localhost:5173").rstrip("/")


@pytest.fixture(scope="session")
def auth_proxy_url() -> str:
    return os.environ.get("AUTH_PROXY_URL", "http://localhost:1042").rstrip("/")


@pytest.fixture(scope="session")
def ui_state_url() -> str:
    """ui-state tier host port. Reachable via reverse-proxy in production;
    the local stack also exposes ui-state's host port for direct probes."""
    return os.environ.get("UI_STATE_URL", "http://localhost:1043").rstrip("/")


@pytest.fixture(scope="session")
def agent_url() -> str:
    return os.environ.get("AGENT_URL", "http://localhost:1041").rstrip("/")


@pytest.fixture(scope="session")
def requires_compose_stack(reverse_proxy_url: str) -> None:
    """Skip the scenario when the local compose stack is not reachable.

    Probes `reverse-proxy:5173` — the user-facing driving port. Per DD-3,
    scenarios drive through the production ingress; ui-state's host port
    is for diagnostic probes only.
    """
    if not _service_reachable(reverse_proxy_url):
        pytest.skip(
            f"compose stack not reachable at {reverse_proxy_url} — "
            f"this scenario needs the local stack up "
            f"(`docker compose up -d` from repo root)",
            allow_module_level=False,
        )


@pytest.fixture(scope="session")
def requires_ts_harness() -> None:
    """Skip when the TS UserFlowHarness `harness.j002.*` namespace is unavailable.

    DELIVER's MR-1 lands the namespace at `tests/acceptance/user-flow-state-machines/harness/`
    (extension of the live J-001 harness). Until then, harness-driven scenarios
    skip. The probe is the presence of the `j002` export in the harness module.
    """
    harness_module = (
        REPO_ROOT
        / "tests"
        / "acceptance"
        / "user-flow-state-machines"
        / "harness"
        / "user-flow-harness.ts"
    )
    if not harness_module.exists():
        pytest.skip(
            f"TS UserFlowHarness not found at {harness_module} — "
            f"J-001 acceptance suite is the host; until it ships the "
            f"`harness.j002.*` namespace (MR-1 DELIVER), this scenario skips.",
            allow_module_level=False,
        )
    text = harness_module.read_text(encoding="utf-8")
    if "j002" not in text:
        pytest.skip(
            "TS UserFlowHarness exists but does not yet export the `j002` "
            "namespace — MR-1 DELIVER lands it.",
            allow_module_level=False,
        )


@pytest.fixture(scope="session")
def requires_node() -> None:
    """Skip when `node` is not on PATH — needed to drive the TS harness via subprocess."""
    if shutil.which("node") is None:
        pytest.skip("node CLI not installed — TS-harness-driven scenarios skip")


@pytest.fixture(scope="session")
def driver(
    reverse_proxy_url: str,
    auth_proxy_url: str,
    ui_state_url: str,
    agent_url: str,
    repo_root: Path,
) -> J002Driver:
    """Higher-level operations used by tests — HTTP probes, file checks, harness driver."""
    return J002Driver(
        reverse_proxy_url=reverse_proxy_url,
        auth_proxy_url=auth_proxy_url,
        ui_state_url=ui_state_url,
        agent_url=agent_url,
        repo_root=repo_root,
    )


@pytest.fixture
def clean_projects_for_dev_user(driver: J002Driver) -> None:
    """Delete all dev-user-001 projects via direct backend HTTP.

    The walking-skeleton + US-201 scenarios assume Maya starts with zero
    projects. Auth-proxy gates `/api/*` behind real JWT verification, so
    tests can't delete via the production ingress — they reach the backend
    directly through docker exec. (Out of band by design — production
    deletes happen via authenticated DELETE; this fixture is a test-only
    janitor.)
    """
    import subprocess

    # List projects.
    list_proc = subprocess.run(
        [
            "docker", "exec", "dashboard-api", "curl", "-s",
            "http://localhost:8000/api/projects",
            "-H", "x-user-id: dev-user-001",
            "-H", "x-org-id: dev-org-001",
            "-H", "x-user-email: dev@localhost",
        ],
        capture_output=True, text=True, timeout=10,
    )
    import json as _json
    try:
        body = _json.loads(list_proc.stdout or "{}")
    except _json.JSONDecodeError:
        return
    items = body.get("data", []) if isinstance(body, dict) else []
    for item in items:
        pid = item.get("id")
        if not pid:
            continue
        subprocess.run(
            [
                "docker", "exec", "dashboard-api", "curl", "-s",
                "-X", "DELETE",
                f"http://localhost:8000/api/projects/{pid}",
                "-H", "x-user-id: dev-user-001",
                "-H", "x-org-id: dev-org-001",
                "-H", "x-user-email: dev@localhost",
            ],
            capture_output=True, text=True, timeout=10, check=False,
        )
