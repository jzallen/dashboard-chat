"""AC1.4 raw-tool-call leak guard — chat-protocol invariant.

Reclassified out of ``tests/acceptance/dbt-test-validation/`` per ADR-024
Phase 2. AC1.4 (ADR-014, OQ5 in ADR-019) is a chat-protocol invariant — it
asserts on the worker's SSE transcript, not on a data-shape outcome — and
therefore does not belong in the dbt-test-validation acceptance suite.

Contract: no Groq tool-call delta may leak through the worker SSE stream.
The agent's ``pipeChatStream`` is the single dispatcher; if a raw tool-call
chunk slips through, the harness's SSE parser surfaces it via
``ChatEventTrace.raw_tool_call_seen`` and ``DatasetLayerHarness.chat_turn``
raises immediately (harness.py — see the inline check before any post-turn
composition runs).

The original v1 scenario lived at
``tests/acceptance/dbt-test-validation/milestone-4-protocol-invariants.feature``
under "After a chat workflow completes, no raw tool-call delta leaks through".
This procedure-shaped pytest test is its semantic equivalent: it drives a
representative chat turn through the same ``DatasetLayerHarness`` and asserts
on the same observable (``raw_tool_call_seen``).

Strategy C (real local I/O, per ADR-019 DWD-1): runs against the 5-service
compose stack via the existing ``dataset_layer_env`` / ``dataset_layer_project``
fixtures, which skip when the stack or Groq is unavailable.
"""

from __future__ import annotations

import os
import pathlib

import pytest

from ..harness import DatasetLayerHarness

# v2 fixtures dir is stable across Phase 4 (the v1 dir is being shrunk);
# referencing v2 keeps this test decoupled from the retiring acceptance suite.
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[5]
_ORDERS_FIXTURE = _REPO_ROOT / "tests" / "acceptance" / "dbt-test-validation-v2" / "fixtures" / "orders.csv"


@pytest.mark.asyncio
async def test_no_raw_tool_call_delta_leaks_through_sse(
    dataset_layer_env: dict[str, str],
    dataset_layer_project: str,
) -> None:
    """A complete chat workflow leaves no raw tool-call frame on the SSE stream.

    AC1.4 invariant: ``ChatEventTrace.raw_tool_call_seen`` must be False after
    ``chat_turn`` returns. ``DatasetLayerHarness.chat_turn`` raises if the flag
    is True, so simply reaching the assertion proves the contract held; the
    explicit assertion pins the surface so a future harness refactor that drops
    the inline raise still fails this test.

    Uses a neutral prompt — the AC1.4 invariant is orthogonal to LLM behavior,
    so a deterministic prompt outcome is not required.
    """
    if not os.environ.get("GROQ_API_KEY"):
        pytest.skip("GROQ_API_KEY not set — AC1.4 requires a real chat turn")
    if not _ORDERS_FIXTURE.exists():
        pytest.skip(f"orders.csv fixture missing at {_ORDERS_FIXTURE}")

    async with DatasetLayerHarness(
        auth_proxy_url=dataset_layer_env["auth_proxy_url"],
        agent_url=dataset_layer_env["agent_url"],
        user_jwt=dataset_layer_env["user_jwt"],
        project_id=dataset_layer_project,
    ) as harness:
        dataset_id = await harness.upload_csv(_ORDERS_FIXTURE)
        trace = await harness.chat_turn(
            "Summarise the columns in this dataset",
            dataset_id=dataset_id,
        )

    assert trace.raw_tool_call_seen is False, (
        f"raw Groq tool-call delta leaked through SSE (AC1.4 violation); "
        f"raw_tool_call_seen={trace.raw_tool_call_seen!r}"
    )
