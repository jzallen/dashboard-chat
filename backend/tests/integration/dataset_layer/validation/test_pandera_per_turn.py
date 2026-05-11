"""Per-turn Pandera validation — shape-correct staging frame happy path.

Ports v1 ``milestone-2-validate-after.feature`` Scenario "Shape-correct
staging frame validates within the per-turn budget" (M2.1) to a plain
integration test. Per ADR-024 DR-1, the Pandera per-turn validator lives
at this integration-test home (NOT a new ``fast_feedback/`` directory and
NOT under ``tests/unit/`` — the validator runs against a real
``TableState.df`` produced by the real backend via the harness's
``validate_after``).

Per DR-5 the ``validate_with`` hook on ``chat_turn`` stays available for
composition; this test exercises the direct ``validate_after`` path the
hook itself delegates to.

Budget rationale (Skill F-004; design.md §6 OQ4): typical <100ms; the
acceptance budget is 200ms to absorb CI/CD variance.
"""

from __future__ import annotations

import pathlib
import time

import pytest

from ..harness import DatasetLayerHarness
from .schemas.orders_staging import OrdersStaging

ORDERS_CSV = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "orders.csv"

PER_TURN_BUDGET_MS = 200.0


@pytest.mark.asyncio
async def test_shape_correct_frame_validates_within_per_turn_budget(
    dataset_layer_env: dict[str, str],
    dataset_layer_project: str,
) -> None:
    """``validate_after`` returns status='pass' within the per-turn budget.

    The orders.csv fixture's columns satisfy ``OrdersStaging`` by
    construction (``region`` is in {North/South/East/West}, email matches
    the pattern, product_category has no leading/trailing whitespace,
    quantity is in 1..10000). With ``strict=False`` on the schema, the
    extra columns (order_id, order_date, etc.) are accepted.
    """
    if not ORDERS_CSV.exists():
        pytest.skip(f"orders fixture missing at {ORDERS_CSV}")

    async with DatasetLayerHarness(
        auth_proxy_url=dataset_layer_env["auth_proxy_url"],
        agent_url=dataset_layer_env["agent_url"],
        user_jwt=dataset_layer_env["user_jwt"],
        project_id=dataset_layer_project,
    ) as h:
        dataset_id = await h.upload_csv(ORDERS_CSV)

        start = time.monotonic()
        result = await h.validate_after(dataset_id, OrdersStaging)
        elapsed_ms = (time.monotonic() - start) * 1000.0

        assert getattr(result, "status", None) == "pass", (
            f"expected validation status='pass', got {getattr(result, 'status', None)!r}; "
            f"errors={getattr(result, 'errors', None)!r}"
        )
        assert elapsed_ms < PER_TURN_BUDGET_MS, (
            f"validate_after took {elapsed_ms:.1f}ms, budget is {PER_TURN_BUDGET_MS}ms "
            "(skill F-004; design §6 OQ4 typical <100ms)"
        )
