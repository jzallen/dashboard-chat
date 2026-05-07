"""Full DatasetLayerHarness acceptance test.

Walks the demo doc's Act 3 workload (10 cleanup ops + 2 count queries)
end-to-end through a real ``docker compose up -d`` SUT (auth-proxy +
backend + worker + query-engine + MinIO per ADR-016). The shape mirrors
``docs/evolution/2026-05-01-api-driven-user-flow-tests.md`` §10 and the
demo script in ``docs/strategy/demo-staging-2026-04-26.md``.

Skip-when-unavailable semantics mirror
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

        # Each op below asserts its precondition (data ISN'T already cleaned)
        # right before its chat_turn, then asserts the post-state. Without the
        # pre-assertion, a fixture in the desired post-state — or a no-op chat
        # path — passes trivially. See dc-9u1 for the gap analysis.

        # ----- Op 1: trim whitespace ----------------------------------------
        text_cols = _expected_clean_columns()
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        assert any(
            isinstance(row.get(col), str) and row[col] != row[col].strip() for row in pre.preview for col in text_cols
        ), "pre-assert op-1: no text column has leading/trailing whitespace; fixture too clean to exercise trim"
        await h.chat_turn(
            "Trim whitespace on every text column",
            dataset_id=dataset_id,
        )
        for col in text_cols:
            await h.assert_no_leading_trailing_whitespace(dataset_id, col)

        # ----- Op 2: standardize region to title case -----------------------
        expected_regions = {"North", "South", "East", "West"}
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        seen_regions = {row["region"] for row in pre.preview if isinstance(row.get("region"), str)}
        assert seen_regions - expected_regions, (
            "pre-assert op-2: region has no non-canonical values (expected to standardize); "
            f"got {sorted(seen_regions)!r}"
        )
        await h.chat_turn(
            "Standardize the region column to title case",
            dataset_id=dataset_id,
        )
        await h.assert_distinct_values(dataset_id, "region", expected_regions)

        # ----- Op 3: fix typo + standardize category ------------------------
        expected_categories = {"Electronics", "Apparel", "Home Goods", "Books", "Toys"}
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        assert any(
            isinstance(row.get("product_category"), str) and "Electornics" in row["product_category"]
            for row in pre.preview
        ), "pre-assert op-3: 'Electornics' typo not present in product_category; fixture has no typo to fix"
        seen_categories = {
            row["product_category"] for row in pre.preview if isinstance(row.get("product_category"), str)
        }
        assert seen_categories - expected_categories, (
            f"pre-assert op-3: product_category already in canonical set; got {sorted(seen_categories)!r}"
        )
        await h.chat_turn(
            'The product category has typos — fix "Electornics" to '
            '"Electronics" and standardize everything to title case',
            dataset_id=dataset_id,
        )
        await h.assert_distinct_values(dataset_id, "product_category", expected_categories)

        # ----- Op 4: standardize payment_method -----------------------------
        raw_payment_variants = {"credit_card", "credit-card", "CREDIT_CARD", "paypal", "apple_pay", "bank_transfer"}
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        seen_payments_pre = {row["payment_method"] for row in pre.preview if "payment_method" in row}
        assert raw_payment_variants & seen_payments_pre, (
            f"pre-assert op-4: no raw payment_method variants present; got {sorted(seen_payments_pre)!r}"
        )
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
        for raw in raw_payment_variants:
            assert raw not in payment_values, f"raw payment_method variant {raw!r} still present after standardization"

        # ----- Op 5: standardize shipping_status to title case --------------
        expected_shipping = {"Delivered", "Pending", "Shipped", "Cancelled"}
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        seen_shipping = {row["shipping_status"] for row in pre.preview if isinstance(row.get("shipping_status"), str)}
        assert seen_shipping - expected_shipping, (
            f"pre-assert op-5: shipping_status already in canonical set; got {sorted(seen_shipping)!r}"
        )
        await h.chat_turn(
            "Standardize shipping_status to title case",
            dataset_id=dataset_id,
        )
        await h.assert_distinct_values(dataset_id, "shipping_status", expected_shipping)

        # ----- Op 6: strip $ from unit_price + convert to number ------------
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        assert any(
            isinstance(row.get("unit_price"), str) and row["unit_price"].lstrip().startswith("$") for row in pre.preview
        ), "pre-assert op-6: no unit_price has $ prefix; fixture has nothing to strip"
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
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        assert any(isinstance(row.get("order_date"), str) and "/" in row["order_date"] for row in pre.preview), (
            "pre-assert op-7: no order_date has slash (US) format; fixture has nothing to convert"
        )
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
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        assert any(row.get("discount_pct") in (None, "") for row in pre.preview), (
            "pre-assert op-8: discount_pct has no null/empty values; fixture has nothing to fill"
        )
        await h.chat_turn(
            "Fill missing values in discount_pct with 0",
            dataset_id=dataset_id,
        )
        await h.assert_no_nulls(dataset_id, "discount_pct")

        # NOTE: ops 9-10 (count by region / product_category) were removed in
        # dc-9u1. The harness's `count_by` is a client-side reduce over the
        # preview window — it never exercised the agent path, so asserting
        # `sum() == 250` was structurally orthogonal to whether chat did
        # anything. Aggregations belong in views/reports (separate epic), not
        # the staging layer's product contract.

    elapsed = time.monotonic() - started
    assert elapsed <= WALL_CLOCK_BUDGET_SECONDS, (
        f"AC1.6 wall-clock budget exceeded: {elapsed:.1f}s > {WALL_CLOCK_BUDGET_SECONDS}s"
    )
