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
# Phase 04 probe-route path (DD-16): `_test-loader-probe.tsx` is mounted here.
os.environ.setdefault("LOADER_PROBE_PATH", "/_test/loader-probe")

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
def requires_slow_mode_capable(reverse_proxy_url: str, auth_proxy_url: str) -> None:
    """Skip cleanly when the local stack lacks SLOW_MODE_DELAY_MS support or isn't running.

    Phase 04 induces the slow-upstream condition via the auth-proxy
    SLOW_MODE_DELAY_MS env var (DD-18). The test caller is expected to have
    brought up the stack with the env var set externally (e.g.,
    `SLOW_MODE_DELAY_MS=10000 docker compose up -d auth-proxy`). This fixture
    skips the scenario when:
      (a) the reverse-proxy isn't reachable at all (Strategy C), OR
      (b) auth-proxy is reachable but a probe to `/_test/loader-probe` returns
          quickly enough to suggest SLOW_MODE isn't set.

    The probe doesn't try to inspect the auth-proxy env directly — it just
    observes the timing behavior. Operator runs the live verification by
    restarting auth-proxy with SLOW_MODE_DELAY_MS set and re-running.
    """
    if not _service_reachable(reverse_proxy_url):
        pytest.skip(
            f"compose stack not reachable at {reverse_proxy_url} — "
            f"this scenario needs the post-MR-3 local stack to be up "
            f"with auth-proxy started under SLOW_MODE_DELAY_MS=10000.",
            allow_module_level=False,
        )
    # Best-effort timing probe: hit the loader probe path; if it responds
    # under 1.0s, SLOW_MODE clearly isn't engaged (the loader's 5s
    # AbortController would only fire if upstream lagged > 5s).
    import time

    import httpx

    try:
        start = time.monotonic()
        with httpx.Client(timeout=8.0, follow_redirects=False) as client:
            r = client.get(f"{reverse_proxy_url}/_test/loader-probe")
        elapsed = time.monotonic() - start
    except OSError as e:
        pytest.skip(f"loader-probe path not reachable: {e}", allow_module_level=False)
    if r.status_code == 200 and elapsed < 1.0:
        pytest.skip(
            "auth-proxy does not appear to be running with SLOW_MODE_DELAY_MS set "
            f"(/_test/loader-probe returned {r.status_code} in {elapsed:.2f}s — "
            "expected hang past 5s with slow mode). Restart the stack with "
            "`SLOW_MODE_DELAY_MS=10000 docker compose up -d auth-proxy` to engage.",
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
