"""Full DatasetLayerHarness acceptance test.

Walks the demo doc's Act 3 workload (10 cleanup ops + 2 count queries)
end-to-end through a real ``docker compose up -d`` SUT (auth-proxy +
backend + worker + query-engine + MinIO per ADR-016). The shape mirrors
``docs/evolution/2026-05-01-api-driven-user-flow-tests.md`` §10 and the
demo script in ``docs/strategy/demo-staging-2026-04-26.md``.

Skip-when-unavailable semantics mirror ``test_smoke_chat_cleaning.py`` and
``backend/tests/integration/test_lake_preview_live.py``: the test is a
permanent guard but only runs when the operator has provisioned the
compose stack and the four required env vars (``AUTH_PROXY_URL``,
``AGENT_URL``, plus a Groq key on the agent container, plus
``M2M_ENABLED=true`` on the auth-proxy for the headless-tokens validation).

Run locally::

    docker compose up -d
    AUTH_PROXY_URL=http://localhost:3000 AGENT_URL=http://localhost:8787 \\
    uv run pytest backend/tests/integration/dataset_layer/test_dataset_staging_layer.py -v

A wall-clock budget of 5 minutes (AC1.6) is asserted at test exit so that
slow Groq turns surface as test failures rather than CI flakes.
"""

from __future__ import annotations

import pathlib
import time

import pytest

from .harness import DatasetLayerHarness

DEMO_CSV = pathlib.Path(__file__).parent / "fixtures" / "ecommerce-orders.csv"

WALL_CLOCK_BUDGET_SECONDS = 300  # AC1.6


def _expected_clean_columns() -> list[str]:
    """Text columns the demo trims/standardizes — used by op-1's check."""
    return ["region", "customer_email", "product_category", "payment_method", "shipping_status"]


@pytest.mark.asyncio
async def test_dataset_staging_layer(
    dataset_layer_env: dict[str, str],
    dataset_layer_pat: str,
    dataset_layer_project: str,
) -> None:
    """Drive the dataset (staging) layer's full chat-driven workload headlessly.

    Workload script (verbatim prompts): docs/strategy/demo-staging-2026-04-26.md.
    """
    if not DEMO_CSV.exists():
        pytest.skip(f"demo CSV fixture missing at {DEMO_CSV}; regenerate via docs/strategy/demo-data-gen-2026-04-26.py")

    started = time.monotonic()

    async with DatasetLayerHarness(
        auth_proxy_url=dataset_layer_env["auth_proxy_url"],
        agent_url=dataset_layer_env["agent_url"],
        user_jwt=dataset_layer_env["user_jwt"],
        project_id=dataset_layer_project,
        pat=dataset_layer_pat,
    ) as h:
        # ----- Setup: upload CSV --------------------------------------------
        dataset_id = await h.upload_csv(DEMO_CSV)
        state = await h.get_table_state(dataset_id)
        assert state.row_count == 250, f"expected 250 rows on upload, got {state.row_count}"
        assert len(state.columns) == 11, f"expected 11 columns, got {len(state.columns)}"

        # ----- Op 1: trim whitespace ----------------------------------------
        await h.chat_turn(
            "Trim whitespace on every text column",
            dataset_id=dataset_id,
        )
        for col in _expected_clean_columns():
            await h.assert_no_leading_trailing_whitespace(dataset_id, col)

        # ----- Op 2: standardize region to title case -----------------------
        await h.chat_turn(
            "Standardize the region column to title case",
            dataset_id=dataset_id,
        )
        await h.assert_distinct_values(
            dataset_id,
            "region",
            {"North", "South", "East", "West"},
        )

        # ----- Op 3: fix typo + standardize category ------------------------
        await h.chat_turn(
            'The product category has typos — fix "Electornics" to '
            '"Electronics" and standardize everything to title case',
            dataset_id=dataset_id,
        )
        await h.assert_distinct_values(
            dataset_id,
            "product_category",
            {"Electronics", "Apparel", "Home Goods", "Books", "Toys"},
        )

        # ----- Op 4: standardize payment_method -----------------------------
        await h.chat_turn(
            'Standardize payment_method to a single canonical form per method (e.g. "Credit Card" not "credit_card")',
            dataset_id=dataset_id,
        )
        # The exact canonical form is LLM-chosen; assert the cardinality + that
        # the historical raw variants have collapsed.
        payment_state = await h.get_table_state(dataset_id)
        payment_values = {row["payment_method"] for row in payment_state.preview if "payment_method" in row}
        assert len(payment_values) <= 5, (
            f"payment_method should collapse to ≤ 5 distinct values, got {sorted(payment_values)!r}"
        )
        for raw in ("credit_card", "credit-card", "CREDIT_CARD", "paypal", "apple_pay", "bank_transfer"):
            assert raw not in payment_values, f"raw payment_method variant {raw!r} still present after standardization"

        # ----- Op 5: standardize shipping_status to title case --------------
        await h.chat_turn(
            "Standardize shipping_status to title case",
            dataset_id=dataset_id,
        )
        await h.assert_distinct_values(
            dataset_id,
            "shipping_status",
            {"Delivered", "Pending", "Shipped", "Cancelled"},
        )

        # ----- Op 6: strip $ from unit_price + convert to number ------------
        await h.chat_turn(
            "Strip the dollar sign from unit_price and convert it to a number",
            dataset_id=dataset_id,
        )
        unit_state = await h.get_table_state(dataset_id)
        for row in unit_state.preview:
            val = row.get("unit_price")
            assert val is None or not (isinstance(val, str) and val.lstrip().startswith("$")), (
                f"unit_price still has dollar sign after strip: {val!r}"
            )

        # ----- Op 7: convert order_date to ISO ------------------------------
        await h.chat_turn(
            "The order_date column has two different formats. Convert everything to ISO format (YYYY-MM-DD)",
            dataset_id=dataset_id,
        )
        date_state = await h.get_table_state(dataset_id)
        for row in date_state.preview:
            val = row.get("order_date")
            if isinstance(val, str) and val:
                assert "/" not in val, f"order_date still has US-format slash: {val!r}"
                # ISO yyyy-mm-dd starts with a 4-digit year.
                assert len(val) >= 10 and val[:4].isdigit(), f"order_date not in ISO YYYY-MM-DD form: {val!r}"

        # ----- Op 8: fill missing discount_pct with 0 -----------------------
        await h.chat_turn(
            "Fill missing values in discount_pct with 0",
            dataset_id=dataset_id,
        )
        await h.assert_no_nulls(dataset_id, "discount_pct")

        # ----- Read 1: count by region --------------------------------------
        # Op 9 in the demo script is "Show me the count of orders by region";
        # the harness `count_by` is the headless analog (the chat-turn version
        # is exercised in op 9 to verify the agent path emits a non-error
        # turn, but the assertion is on the deterministic backend reduce).
        await h.chat_turn(
            "Show me the count of orders by region",
            dataset_id=dataset_id,
        )
        by_region = await h.count_by(dataset_id, "region")
        assert sum(by_region.values()) == 250, (
            f"region totals should sum to 250, got {sum(by_region.values())}: {by_region!r}"
        )
        assert len(by_region) == 4, f"expected 4 regions, got {len(by_region)}: {by_region!r}"

        # ----- Read 2: count by product_category ----------------------------
        await h.chat_turn(
            "And by product category",
            dataset_id=dataset_id,
        )
        by_cat = await h.count_by(dataset_id, "product_category")
        assert sum(by_cat.values()) == 250, (
            f"product_category totals should sum to 250, got {sum(by_cat.values())}: {by_cat!r}"
        )
        assert len(by_cat) == 5, f"expected 5 categories, got {len(by_cat)}: {by_cat!r}"

    elapsed = time.monotonic() - started
    assert elapsed <= WALL_CLOCK_BUDGET_SECONDS, (
        f"AC1.6 wall-clock budget exceeded: {elapsed:.1f}s > {WALL_CLOCK_BUDGET_SECONDS}s"
    )
