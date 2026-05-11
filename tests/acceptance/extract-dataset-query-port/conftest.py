"""Acceptance-test configuration for extract-dataset-query-port (ADR-021).

This conftest sits at the feature-test root so pytest-bdd can locate the
.feature files and shared step glue under steps/.

Strategy C (real local I/O) — mirrors dbt-test-validation/conftest.py
(DWD-1 there). The walking-skeleton scenario exercises the real
query-engine pool through the new ``QueryEnginePort``; milestone-1,
milestone-2 and milestone-3 scenarios use a recording stand-in
connection that satisfies the same protocol surface as
``backend/tests/models/test_dataset.py``'s ``_FakeConnection`` ladder
(relocated by DELIVER per DWD-4).

Skip-when-unavailable: the session-scoped ``query_engine_pool`` fixture
performs a reachability probe against the configured query-engine host;
unreachable substrate translates to ``pytest.skip(reason)`` with the
failing probe NAMED — substrate breakage becomes a labelled skip rather
than a silent green or a confusing red (Earned-Trust contract,
ADR-021 §"Earned-Trust contract").
"""
from __future__ import annotations

import os
import socket
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio

# Star-import surfaces the @given/@when/@then bindings to test_*.py modules
# (pytest-bdd resolves through conftest's namespace). Ruff would strip the
# import without the noqa marker — skill F-003.
sys.path.insert(0, str(Path(__file__).parent))
# The query-engine port lives under backend/app/query_engine/; make the
# backend package roots importable so the session-scoped fixture can
# construct the real adapter.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))
from steps.dataset_query_port_steps import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------------------
# Skip-when-unavailable helpers (Strategy C — mirrors dbt-test-validation)
# ---------------------------------------------------------------------------


def _service_reachable(host: str, port: int, timeout: float = 0.5) -> bool:
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


@pytest.fixture(scope="session")
def query_engine_reachable() -> bool:
    """True iff the query-engine service (Postgres + pg_duckdb) accepts TCP.

    Reads the same settings the backend reads via ``app.config.get_settings``
    — but via env vars to avoid importing the backend's settings stack at
    fixture-collection time. Defaults match docker-compose.yml's
    query-engine service (port 5433 inside the compose network, exposed as
    5433 on the host by convention).
    """
    host = os.environ.get("QUERY_ENGINE_HOST", "localhost")
    port = int(os.environ.get("QUERY_ENGINE_PORT", "5433"))
    return _service_reachable(host, port)


@pytest.fixture(scope="session")
def requires_query_engine(query_engine_reachable: bool) -> None:
    if not query_engine_reachable:
        pytest.skip(
            "query-engine service not reachable on QUERY_ENGINE_HOST/PORT; "
            "run `docker compose up -d query-engine` and retry"
        )


@pytest_asyncio.fixture(scope="session")
async def query_engine_pool(
    requires_query_engine: None,
) -> AsyncIterator[Any]:
    """Session-scoped real asyncpg pool against the running query-engine.

    This is the ONLY composition site where the walking-skeleton scenario
    obtains a real pool — every step that needs it threads through this
    fixture (composition-root invariant, ADR-021 §"Earned-Trust contract":
    "wire then probe then use"). Probe failures translate to
    ``pytest.skip(reason)`` with the failing probe name in the reason.

    DELIVER will likely replace this body with a delegation through the
    new ``QueryEnginePort.probe()`` once the port exists. For DISTILL the
    fixture is a thin probe-and-yield against ``asyncpg.create_pool``
    directly; the walking-skeleton step glue then constructs the
    ``PgDuckDBQueryEngineAdapter`` against this pool.
    """
    # Imports deferred to fixture-evaluation time so test collection never
    # depends on the backend's heavyweight imports. If asyncpg is missing
    # from this venv (e.g. a contributor running the suite without the
    # dev group installed), skip with a clear reason rather than failing
    # collection.
    try:
        import asyncpg
    except ImportError as exc:  # pragma: no cover — env-gating path
        pytest.skip(
            f"query_engine_pool: asyncpg not importable in this venv ({exc!r}); "
            f"run `uv sync --group dev` from this directory and retry."
        )

    host = os.environ.get("QUERY_ENGINE_HOST", "localhost")
    port = int(os.environ.get("QUERY_ENGINE_PORT", "5433"))
    user = os.environ.get("QUERY_ENGINE_ADMIN_USER", "duckdb")
    password = os.environ.get("QUERY_ENGINE_ADMIN_PASSWORD", "duckdb")
    database = os.environ.get("QUERY_ENGINE_DATABASE", "duckdb")

    try:
        pool = await asyncpg.create_pool(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            min_size=1,
            max_size=2,
            statement_cache_size=0,
            max_cached_statement_lifetime=0,
        )
    except Exception as exc:  # pragma: no cover — env-gating path
        pytest.skip(
            f"query_engine_pool: asyncpg.create_pool failed ({exc!r}); "
            f"the query-engine service is unreachable or rejecting our credentials."
        )

    # Probe: SELECT 1 + duckdb.raw_query('SELECT 1') verifies pg_duckdb is
    # loaded. DELIVER's QueryEnginePort.probe() will own this contract.
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
            try:
                await conn.execute("SELECT duckdb.raw_query('SELECT 1')")
            except Exception as exc:  # pragma: no cover — env-gating path
                await pool.close()
                pytest.skip(
                    f"query_engine_pool: pg_duckdb extension probe failed ({exc!r}); "
                    f"check that the query-engine container has pg_duckdb installed."
                )
    except Exception as exc:  # pragma: no cover — env-gating path
        await pool.close()
        pytest.skip(
            f"query_engine_pool: liveness probe (SELECT 1) failed ({exc!r})."
        )

    try:
        yield pool
    finally:
        await pool.close()
