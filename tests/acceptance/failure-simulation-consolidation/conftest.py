"""Pytest configuration for the failure-simulation-consolidation acceptance suite.

Strategy: tests exercise the new `shared/failure-simulation/` registry through
its public TypeScript API (driven from Python via `node` subprocess for the
unit-shaped scenarios) and through the running dev compose stack for the
gate-startup, inspection-probe, and audit-sink scenarios.

Test stratification mirrors `docs/feature/failure-simulation-consolidation/design/handoff-design-to-distill.md`:

- Group A (22 scenarios) — directly exercise the registry's public API
  (`probe`, `shouldInject`, `detectUnknownSignals`, `assertKnown`, `manifest`,
  `KNOB`, `registerInspectionRoutes`). Net-new tests.

- Group B (6 scenarios) — migration safety-net. Cross-reference the existing
  `project-and-chat-session-management` suite. Do NOT modify that suite from
  here; treat it as ground truth.

- Group C (1 scenario) — `NWAVE_HARNESS_KNOBS` deprecation event.

Contract assertions CA-1..CA-9 live in `test_contract_assertions.py`.

All scenarios are RED at DISTILL handoff — the `shared/failure-simulation/`
module does not yet exist. The fixtures `requires_shared_failure_simulation`
and `requires_node` are documented preconditions; they do not pre-skip the
suite — the tests fail naturally with `FileNotFoundError` or `ImportError`
against the absent module, and DELIVER's job is to turn them GREEN.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from driver import FailureSimulationDriver  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
SHARED_FAILURE_SIMULATION_DIR = REPO_ROOT / "shared" / "failure-simulation"
MANIFEST_FILE = SHARED_FAILURE_SIMULATION_DIR / "manifest.ts"


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
def shared_failure_simulation_dir() -> Path:
    """Canonical path to the registry package — DELIVER's MR-1 lands this."""
    return SHARED_FAILURE_SIMULATION_DIR


@pytest.fixture(scope="session")
def manifest_path() -> Path:
    """Canonical path to the manifest file (the SSOT data)."""
    return MANIFEST_FILE


@pytest.fixture(scope="session")
def reverse_proxy_url() -> str:
    return os.environ.get("REVERSE_PROXY_URL", "http://localhost:5173").rstrip("/")


@pytest.fixture(scope="session")
def ui_state_url() -> str:
    return os.environ.get("UI_STATE_URL", "http://localhost:1043").rstrip("/")


@pytest.fixture(scope="session")
def agent_url() -> str:
    return os.environ.get("AGENT_URL", "http://localhost:1041").rstrip("/")


@pytest.fixture(scope="session")
def requires_node() -> None:
    """Skip when `node` is not on PATH — needed to drive the TS registry."""
    if shutil.which("node") is None:
        pytest.skip("node CLI not installed — TS-registry-driven scenarios skip")


@pytest.fixture(scope="session")
def requires_compose_stack(reverse_proxy_url: str) -> None:
    """Skip when the local compose stack is not reachable."""
    if not _service_reachable(reverse_proxy_url):
        pytest.skip(
            f"compose stack not reachable at {reverse_proxy_url} — "
            f"start it with `docker compose up -d` from repo root",
            allow_module_level=False,
        )


@pytest.fixture(scope="session")
def requires_shared_failure_simulation(
    shared_failure_simulation_dir: Path,
) -> None:
    """Document the precondition that the registry package exists.

    At DISTILL handoff this is intentionally NOT a skip — the suite is RED by
    design until DELIVER lands MR-1. Tests fail with a naked ``FileNotFoundError``
    so the gap is obvious in the pytest output.

    DELIVER may convert this into a hard precondition once MR-1 lands by
    swapping the assertion to `pytest.skip(...)`; doing so before MR-1 would
    mask the RED state DISTILL hands off.
    """
    if not shared_failure_simulation_dir.exists():
        # Surface a clear assertion failure for DELIVER's RED-loop signal.
        # NOT a skip — see docstring.
        raise FileNotFoundError(
            f"shared/failure-simulation/ does not exist at "
            f"{shared_failure_simulation_dir}. This suite is RED until "
            f"DELIVER MR-1 lands the registry package."
        )


@pytest.fixture(scope="session")
def driver(
    reverse_proxy_url: str,
    ui_state_url: str,
    agent_url: str,
    repo_root: Path,
    shared_failure_simulation_dir: Path,
) -> FailureSimulationDriver:
    """Higher-level operations the failure-simulation tests compose."""
    return FailureSimulationDriver(
        reverse_proxy_url=reverse_proxy_url,
        ui_state_url=ui_state_url,
        agent_url=agent_url,
        repo_root=repo_root,
        registry_dir=shared_failure_simulation_dir,
    )


@pytest.fixture
def captured_stdout_events(
    driver: FailureSimulationDriver,
) -> Iterator[list[dict[str, object]]]:
    """Yield a list that the registry-driver helpers populate with parsed
    JSON-line audit events captured from subprocess stdout.

    Tests append entries via `driver.run_registry_script(...)` which writes
    audit events with `console.log(JSON.stringify(...))` per ADR-037.
    """
    bucket: list[dict[str, object]] = []
    driver._stdout_event_bucket = bucket  # noqa: SLF001 — driver-private hand-off
    yield bucket
    driver._stdout_event_bucket = None  # noqa: SLF001
