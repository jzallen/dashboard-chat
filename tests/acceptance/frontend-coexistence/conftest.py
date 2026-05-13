"""Pytest configuration for the frontend-coexistence acceptance suite.

Strategy C (DI-1): drive the real local compose stack when it is reachable;
skip cleanly otherwise. Most scenarios are HTTP probes against
`reverse-proxy` (host port 5173 by default), file-system inspections of
the repo working tree, or `docker compose config --services` subprocess
calls.

Every scenario is marked `pytest.mark.skip(...)` at the DISTILL→DELIVER
handoff (DI-8). DELIVER's first action per `roadmap.json` phase is to
remove the skip from the listed scenarios.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from driver import FrontendCoexistenceDriver  # noqa: E402

# Phase 03 reversibility pinned refs (see deliver/wave-decisions.md DD-15).
# PRE_SLICE_2_REF = pre-Slice-2 commit (the byte-equivalent baseline `/login` reverts to).
# POST_SLICE_2_REF = Slice-2 commit (the `/login` loader-bearing state MR-2 mirrors against).
os.environ.setdefault("PRE_SLICE_2_REF", "cc7e517")
os.environ.setdefault("POST_SLICE_2_REF", "d052896")
# POST_MR_2_REF intentionally stays unset; the test default is "HEAD" which is
# the correct value for any local run after MR-2 lands.

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
def requires_compose_stack(reverse_proxy_url: str) -> None:
    """Skip the scenario when the local compose stack is not reachable.

    Probes `reverse-proxy:5173` directly. The scenario does not depend
    on `auth-proxy` being healthy on its own host port; it depends on
    nginx being able to reach `web-ssr` over the compose network, which
    `reverse-proxy:5173` is the user-facing observation point of.
    """
    if not _service_reachable(reverse_proxy_url):
        pytest.skip(
            f"compose stack not reachable at {reverse_proxy_url} — "
            f"this scenario needs the post-MR-0 local stack to be up "
            f"(`docker compose up -d` from repo root)",
            allow_module_level=False,
        )


@pytest.fixture(scope="session")
def requires_repo_post_mr0_state(repo_root: Path) -> None:
    """Skip when the repo working tree does NOT reflect the post-MR-0 state.

    Post-MR-0 invariants: `frontend/App.tsx` is deleted, `ui-presentation/`
    is gone, `frontend/app/root.tsx` and `frontend/app/routes.ts` exist.
    Each scenario asserts a specific sub-property; this fixture is the
    coarse-grained pre-check that confirms the working tree has any
    post-MR-0 state at all (so per-scenario assertions are meaningful
    rather than spuriously red).
    """
    sentinel = repo_root / "frontend" / "app" / "root.tsx"
    if not sentinel.exists():
        pytest.skip(
            f"repo is in pre-MR-0 state — `{sentinel.relative_to(repo_root)}` "
            f"does not exist. This scenario asserts a post-MR-0 invariant; "
            f"DELIVER's MR-0 lands `frontend/app/root.tsx` and unpends this scenario.",
            allow_module_level=False,
        )


@pytest.fixture(scope="session")
def driver(reverse_proxy_url: str, auth_proxy_url: str, repo_root: Path) -> FrontendCoexistenceDriver:
    """Higher-level operations used by tests — HTTP probes, file checks, compose introspection."""
    return FrontendCoexistenceDriver(
        reverse_proxy_url=reverse_proxy_url,
        auth_proxy_url=auth_proxy_url,
        repo_root=repo_root,
    )


@pytest.fixture
def docker_compose_services(repo_root: Path) -> list[str]:
    """Return the list of services in the repo's `docker-compose.yml`.

    Used by §3.8 container-delta scenarios. Runs `docker compose config
    --services` as a subprocess; skips if Docker is not available.
    """
    try:
        result = subprocess.run(
            ["docker", "compose", "config", "--services"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except FileNotFoundError:
        pytest.skip("docker CLI not installed — skipping compose-introspection scenario")
    except subprocess.TimeoutExpired:
        pytest.skip("`docker compose config --services` timed out")
    if result.returncode != 0:
        pytest.skip(
            f"`docker compose config --services` failed (rc={result.returncode}): "
            f"{result.stderr.strip()}"
        )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]
