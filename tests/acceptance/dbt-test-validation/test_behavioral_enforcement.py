"""Behavioral enforcement of ADR-019 §"Earned-Trust contract" — 3rd layer.

ADR-019 §4 specifies three orthogonal enforcement layers for the
probe contract:
    1. Subtype  — mypy + ``EjectOrchestratorProtocol``
    2. Structural — pytest-archon rule (deferred to a follow-up wave)
    3. Behavioral — THIS test

The behavioral layer asserts that when the substrate lies, the
orchestrator's ``probe()`` produces a structured failure that the
conftest's session fixture converts to ``pytest.skip(reason)``
with the failing probe NAMED. Without this layer, the probe
contract could regress silently — a probe that returns ok=True
under a broken substrate would let the suite green falsely.

Atlas (nw-solution-architect-reviewer, DESIGN review) flagged the
behavioral layer as a deferred minor item (review.yaml lines 101-
104). DWD-10 (DISTILL wave-decisions) records the resolution: this
test, run under the standard acceptance suite, is the behavioral
enforcement integration point. No separate CI job needed.

Operationally: run alongside the standard acceptance suite —
    cd tests/acceptance/dbt-test-validation && \\
      AUTH_PROXY_URL=... AGENT_URL=... uv run --project . pytest \\
      test_behavioral_enforcement.py
The README documents this in §"Behavioral enforcement (ADR-019)".
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))


@pytest.mark.asyncio
async def test_substrate_sabotage_surfaces_named_probe_failure(
    tmp_path: Path,
    requires_compose_stack: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sabotage probe 1 out-of-band; verify probe() surfaces the lie loudly.

    This is the behavioral enforcement of ADR-019 §"Earned-Trust
    contract". The conftest's session-scoped ``eject_orchestrator``
    fixture converts probe failure to ``pytest.skip(reason)``;
    this test proves the conversion has actually-failing input
    to act on — i.e., the probe path is wired end-to-end and a
    broken substrate cannot silently green the suite.
    """
    # Eager import order matters here:
    #
    #   * `orchestrator.py` -> imports `.runner` at module load
    #   * `runner.py`       -> imports `dbtRunner` from `dbt.cli.main` at
    #     module load
    #
    # If we monkeypatch `delattr(dbt.cli.main, "dbtRunner")` BEFORE the
    # orchestrator module is imported, the `runner.py` module-level import
    # itself raises ImportError — sabotaging probe 1 turns into a
    # collection-time crash rather than the structured probe failure we
    # want to assert. Pre-load the orchestrator first so its transitive
    # imports are cached in `sys.modules`, then sabotage. The probe's
    # body re-imports `dbtRunner` at call time and DOES see the missing
    # attribute, which is exactly the contract under test.
    #
    # The M3 scenarios don't hit this because the session-scoped
    # `eject_orchestrator` fixture loads the orchestrator module at
    # session-start (before any per-test monkeypatch lands).
    from tests.integration.dataset_layer.eject.orchestrator import (
        EjectAndTestOrchestrator,
    )

    # Sabotage probe 1's substrate: the same monkeypatch pattern the M3
    # step binding `given_dbt_runner_broken` uses. monkeypatch reverts at
    # function-scope teardown, so other tests in the same session that
    # need a healthy `dbtRunner` are unaffected.
    import dbt.cli.main

    monkeypatch.delattr(dbt.cli.main, "dbtRunner", raising=False)

    async def _stub_token(_url: str) -> str:
        return "stub-token-for-behavioral-enforcement"

    minio_creds = {
        "endpoint_url": os.environ.get("S3_ENDPOINT", "http://localhost:9000"),
        "access_key": os.environ.get("S3_ACCESS_KEY_ID", "minioadmin"),
        "secret_key": os.environ.get("S3_SECRET_ACCESS_KEY", "minioadmin"),
        "bucket": os.environ.get("S3_BUCKET", "dashboard-chat.datalake"),
        "region": os.environ.get("S3_REGION", "us-east-1"),
    }
    base_url = os.environ.get("AUTH_PROXY_URL", "http://localhost:3000").rstrip("/")

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        orchestrator = EjectAndTestOrchestrator(
            http_client=client,
            base_url=base_url,
            minio_creds=minio_creds,
            auth_token_minter=_stub_token,
        )
        summary = await orchestrator.probe(tmp_path)

    assert summary.ok is False, (
        f"sabotaged substrate produced summary.ok=True — the probe "
        f"path is NOT wired (reports={summary.reports!r})"
    )

    # The failing-probe NAME must surface in the failures list — that
    # is the Earned-Trust contract's "skip reason names the probe"
    # invariant.
    failing_names = {r.name for r in summary.failures}
    assert "probe_dbt_runner_importable" in failing_names, (
        f"sabotaged dbt.cli.main.dbtRunner did not surface the "
        f"probe_dbt_runner_importable failure; failing_names={failing_names!r}"
    )

    # Mirror the conftest skip-message construction so any future
    # divergence between conftest format and behavioral expectation
    # surfaces here, not as a quiet drift.
    failing_names_str = ", ".join(r.name for r in summary.failures)
    failing_reasons = "; ".join(
        f"{r.name}: {r.reason}" for r in summary.failures
    )
    skip_reason = (
        f"eject orchestrator probe failed ({failing_names_str}); "
        f"details: {failing_reasons}"
    )
    assert "probe_dbt_runner_importable" in skip_reason, (
        f"the conftest-format skip reason does not name the failing "
        f"probe; skip_reason={skip_reason!r}"
    )
