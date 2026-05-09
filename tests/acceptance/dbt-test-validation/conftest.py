"""Acceptance-test configuration for dbt-test-validation (ADR-019, Option β).

This conftest sits at the feature-test root so pytest-bdd can locate the
.feature files and shared step glue under steps/.

Strategy C (real local I/O) per DWD-1:
- real 5-service compose stack (auth-proxy + backend + worker + query-engine + MinIO)
- real Groq via the existing harness conftest (skip-when-unavailable)
- real `dbtRunner` from `dbt.cli.main`
- real DuckDB + MinIO Parquet read path
- skip-when-unavailable: per-adapter via @requires_external markers and
  the session-scoped `eject_orchestrator` fixture's probe semantics
  (probe failure -> pytest.skip with the failing probe named).
"""
from __future__ import annotations

import os
import socket
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import pytest
import pytest_asyncio

# Star-import surfaces the @given/@when/@then bindings to test_*.py modules
# (pytest-bdd resolves through conftest's namespace, not just the plugin
# registry). Ruff would strip the import without the noqa marker — skill F-003.
sys.path.insert(0, str(Path(__file__).parent))
# The harness lives under backend/; make its package roots importable so the
# `eject_orchestrator` fixture can construct the real orchestrator (the same
# sys.path additions the step glue does — keep them in conftest too so the
# fixture imports resolve regardless of test-collection order).
_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))
from steps.dbt_test_validation_steps import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------------------
# Skip-when-unavailable helpers (Strategy C — DWD-1)
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


@pytest.fixture(scope="session")
def compose_stack_available() -> bool:
    """True iff the 5-service compose stack is reachable on its published ports.

    Walking-skeleton and milestone scenarios depend on the running stack;
    when it is absent (e.g. on a contributor laptop without `docker compose
    up`), the relevant scenarios skip with an informative reason rather
    than failing.
    """
    auth_proxy = os.environ.get("AUTH_PROXY_URL", "http://localhost:3000")
    agent = os.environ.get("AGENT_URL", "http://localhost:8787")
    return _service_reachable(auth_proxy) and _service_reachable(agent)


@pytest.fixture(scope="session")
def requires_compose_stack(compose_stack_available: bool) -> None:
    if not compose_stack_available:
        pytest.skip(
            "compose stack not reachable on AUTH_PROXY_URL / AGENT_URL; "
            "run `docker compose up -d` and retry"
        )


@pytest.fixture(scope="session")
def requires_groq() -> None:
    """Skip when GROQ_API_KEY is unset.

    Mirrors the existing harness convention at
    backend/tests/integration/dataset_layer/test_smoke_chat_cleaning.py.
    Walking-skeleton + milestone-2 retry scenarios require real Groq; the
    eject-and-test path itself does not (it operates on already-produced
    DuckDB state).
    """
    if not os.environ.get("GROQ_API_KEY"):
        pytest.skip("GROQ_API_KEY not set — chat-driven scenarios require real Groq")


@dataclass(frozen=True)
class EjectSessionContext:
    """Session-scoped composition-root output.

    Holds both the probed ``EjectAndTestOrchestrator`` and the session
    ``tmp_path`` the harness threads into ``eject_and_test`` calls. Per
    orchestrator.py the caller controls the tmpdir lifetime; the session
    tmp_path returned here is what the @when step passes through the
    harness facade.
    """

    orchestrator: Any
    session_tmp_path: Path


def _read_minio_creds_from_env() -> dict[str, str]:
    """Build the orchestrator's ``minio_creds`` dict from environment.

    The exported ``profiles.yml`` template references ``S3_BUCKET``,
    ``S3_REGION``, ``S3_ACCESS_KEY_ID``, ``S3_SECRET_ACCESS_KEY``, and
    ``S3_ENDPOINT`` (see ``backend/app/use_cases/project/_dbt/profiles_yml.py``);
    ``DuckDBProfileSeeder`` rewrites those placeholders with the values
    here. Defaults match the local compose stack's MinIO defaults so a
    contributor running ``docker compose up -d`` against the canonical
    .env never has to hand-export credentials.
    """
    # Default bucket matches the canonical name in ``backend/.env.example``
    # (``STORAGE_BUCKET=dashboard-chat.datalake``) — that is the bucket the
    # backend's compose stack actually creates and writes uploads into.
    # Earlier drafts defaulted to ``dashboard-chat`` which doesn't exist in
    # the running compose stack, causing the MinIO probe to 404 with
    # NoSuchBucket. Override with ``S3_BUCKET=...`` for non-default deploys.
    return {
        "endpoint_url": os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
        "access_key": os.environ.get("S3_ACCESS_KEY_ID", "minioadmin"),
        "secret_key": os.environ.get("S3_SECRET_ACCESS_KEY", "minioadmin"),
        "bucket": os.environ.get("S3_BUCKET", "dashboard-chat.datalake"),
        "region": os.environ.get("S3_REGION", "us-east-1"),
    }


@pytest_asyncio.fixture(scope="session")
async def eject_orchestrator(
    requires_compose_stack: None,
    tmp_path_factory: pytest.TempPathFactory,
) -> AsyncIterator[EjectSessionContext]:
    """Session-scoped composition root (ADR-019 §4 invariant: wire then probe then use).

    Constructs the orchestrator with a real ``httpx.AsyncClient``, real
    MinIO credentials from environment, and the same auth-proxy ingress
    base URL the harness uses. Invokes ``probe()`` exactly once per
    pytest session against a session-scoped ``tmp_path``. On any probe
    failure, calls ``pytest.skip`` with the failing probe NAMED in the
    reason — substrate breakage becomes a clearly-labelled skip rather
    than a silent green or a confusing red (Earned-Trust contract,
    ADR-019 §4).

    This is the ONLY place in the acceptance suite where the orchestrator
    is constructed — every test that needs it goes through this fixture
    (architectural enforcement, ADR-019 §11). The yielded
    ``EjectSessionContext`` carries both the probed orchestrator and the
    session ``tmp_path`` the harness threads into ``eject_and_test``.
    """
    # Imports deferred to fixture-evaluation time so test collection never
    # depends on the backend's heavyweight imports (pandas/pandera/dbt).
    # The fixture only runs when a scenario actually consumes it; if those
    # imports fail in this venv, the scenario skips with a clear reason
    # rather than failing collection for the whole acceptance suite.
    try:
        from tests.integration.dataset_layer.eject.orchestrator import (
            EjectAndTestOrchestrator,
        )
    except ImportError as exc:  # pragma: no cover — env-gating path
        pytest.skip(
            f"eject_orchestrator: backend test deps not importable in this "
            f"venv ({exc!r}); install pandas/pandera/dbt-core/dbt-duckdb to run."
        )

    auth_proxy_url = os.environ.get("AUTH_PROXY_URL", "http://localhost:3000").rstrip("/")
    minio_creds = _read_minio_creds_from_env()
    session_tmp = tmp_path_factory.mktemp("eject")

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        orchestrator = EjectAndTestOrchestrator(
            http_client=client,
            base_url=auth_proxy_url,
            minio_creds=minio_creds,
        )
        summary = await orchestrator.probe(session_tmp)
        if not summary.ok:
            failing_names = ", ".join(report.name for report in summary.failures) or "<unknown>"
            failing_reasons = "; ".join(
                f"{report.name}: {report.reason}" for report in summary.failures
            )
            pytest.skip(
                f"eject orchestrator probe failed ({failing_names}); "
                f"details: {failing_reasons}"
            )

        yield EjectSessionContext(
            orchestrator=orchestrator,
            session_tmp_path=session_tmp,
        )
