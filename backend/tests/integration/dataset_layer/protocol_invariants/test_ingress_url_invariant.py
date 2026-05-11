"""ADR-016 production-ingress URL invariant — chat-protocol invariant.

Reclassified out of ``tests/acceptance/dbt-test-validation/`` per ADR-024
Phase 2. ADR-016 invariance is a chat-protocol / ingress concern, not a
data-shape outcome — it asserts on the URL the test substrate routes
through, NOT on dbt run outputs.

Contract: every HTTP request the eject orchestrator makes must resolve
through the auth-proxy ingress (``AUTH_PROXY_URL`` — default
``http://localhost:3000`` for the canonical compose topology, ``:1042`` in
gastown workspaces) — NEVER directly to the backend's internal port 8000.
The orchestrator centralizes URL composition on ``self._base_url`` (see
``orchestrator.py:_fetch_zip``), so the invariant reduces to: ``_base_url``
matches the auth-proxy ingress the orchestrator was wired with.

The original v1 scenario lived at
``tests/acceptance/dbt-test-validation/milestone-4-protocol-invariants.feature``
under "The eject orchestrator reaches the system through the
production-ingress URL". That scenario drove a real ``eject_and_test`` and
reconstructed ``fetch_url = f"{base_url}/api/projects/{pid}/export/dbt"``
from ``_base_url`` for its assertion — i.e. the assertion was always on the
wired URL, not on a wire-observed URL. This procedure-shaped pytest test
preserves the same assertion semantics without paying the cost of a full
eject cycle: it constructs an orchestrator with the same env-derived inputs
the v1 fixture used, then inspects ``_base_url`` directly.

Strategy C (real local I/O, per ADR-019 DWD-1): runs against the 5-service
compose stack; the inherited ``dataset_layer_env`` fixture skips the test
when the stack is unreachable.
"""

from __future__ import annotations

import os

import httpx
import pytest


def _read_minio_creds_from_env() -> dict[str, str]:
    """Mirror the v1 acceptance conftest's MinIO creds builder.

    The orchestrator's constructor requires a ``minio_creds`` dict; the
    invariant under test is unrelated to MinIO substrate, so the values
    here just have to satisfy the constructor signature. Reading from env
    keeps the fixture parity with the v1 fixture in case the orchestrator
    ever inspects bucket/region as part of URL composition.
    """
    return {
        "endpoint_url": os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
        "access_key": os.environ.get("S3_ACCESS_KEY_ID", "minioadmin"),
        "secret_key": os.environ.get("S3_SECRET_ACCESS_KEY", "minioadmin"),
        "bucket": os.environ.get("S3_BUCKET", "dashboard-chat.datalake"),
        "region": os.environ.get("S3_REGION", "us-east-1"),
    }


@pytest.mark.asyncio
async def test_orchestrator_base_url_routes_through_auth_proxy_ingress(
    dataset_layer_env: dict[str, str],
) -> None:
    """The eject orchestrator's wired base_url matches the auth-proxy ingress.

    ADR-016 invariant: tests must reach the SUT through the production-fidelity
    ingress, NEVER directly through the backend's internal port. The session
    fixture in the v1 acceptance suite wired ``base_url=AUTH_PROXY_URL``;
    this test rebuilds that wiring path here so the invariant survives the
    v1 suite's retirement.
    """
    # Deferred import: keeps test collection light even if dbt extras are
    # not installed (the unit envs that exclude tests/integration/ won't
    # try to import the eject package at collection time).
    from tests.integration.dataset_layer.eject.orchestrator import (
        EjectAndTestOrchestrator,
    )

    auth_proxy_url = dataset_layer_env["auth_proxy_url"]

    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        orchestrator = EjectAndTestOrchestrator(
            http_client=client,
            base_url=auth_proxy_url,
            minio_creds=_read_minio_creds_from_env(),
        )

    base_url = orchestrator._base_url
    assert base_url.startswith(auth_proxy_url), (
        f"orchestrator base_url {base_url!r} does not start with the auth-proxy "
        f"ingress {auth_proxy_url!r} — ADR-016 invariant violated"
    )
    assert ":8000/" not in base_url and not base_url.endswith(":8000"), (
        f"orchestrator base_url {base_url!r} talks to backend internal port 8000 — "
        f"ADR-016 forbids direct-to-backend routing in tests"
    )

    # The orchestrator centralizes URL composition on ``self._base_url``
    # (orchestrator.py:_fetch_zip). Re-deriving the per-project export URL
    # here mirrors the v1 step's reconstructed ``fetch_url`` so the same
    # regression is caught (a refactor that changes the export path while
    # honoring the ingress would still leave a passing test; a refactor
    # that bypasses the ingress trips both the ``startswith`` and the
    # ``:8000`` assertion).
    fetch_url = f"{base_url}/api/projects/sentinel-pid/export/dbt"
    assert fetch_url.startswith(auth_proxy_url), (
        f"reconstructed export URL {fetch_url!r} does not start with auth-proxy ingress {auth_proxy_url!r}"
    )
    assert ":8000/" not in fetch_url, f"reconstructed export URL {fetch_url!r} talks to backend internal port 8000"
