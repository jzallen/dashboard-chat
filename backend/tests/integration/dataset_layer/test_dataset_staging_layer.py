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

import pandas as pd
import pytest

from .harness import DatasetLayerHarness, TableState


def _str_values(state: TableState, column: str) -> pd.Series:
    """Non-null string values from ``state.df[column]``.

    The API returns mixed types per column (string before normalization,
    numeric after, ``None`` for missing). Pandas .str accessors raise on
    numeric-dtype Series, so callers that need string ops must drop both
    nulls and non-string entries first.
    """
    s = state.df[column].dropna()
    return s[s.map(lambda v: isinstance(v, str))]


DEMO_CSV = pathlib.Path(__file__).parent / "fixtures" / "ecommerce-orders.csv"

WALL_CLOCK_BUDGET_SECONDS = 300  # AC1.6


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

        # Upload sanity: CsvPlugin strips leading/trailing whitespace on every
        # text column at upload time. This used to be a chat-cleanable op (op-1
        # in the original demo workload), but the auto-trim makes a chat-driven
        # trim redundant — so the assertion lives here at the boundary instead.
        for col in ("region", "customer_email", "product_category", "payment_method", "shipping_status"):
            assert await h.assert_no_leading_trailing_whitespace(dataset_id, col), (
                f"upload sanity: column {col!r} arrived with leading/trailing whitespace; "
                "CsvPlugin upload-time trim should have stripped it"
            )

        # Each op below asserts its precondition (data ISN'T already cleaned)
        # right before its chat_turn, then asserts the post-state. Without the
        # pre-assertion, a fixture in the desired post-state — or a no-op chat
        # path — passes trivially. See dc-9u1 for the gap analysis.

        # ----- Op 1: standardize region to title case -----------------------
        expected_regions = {"North", "South", "East", "West"}
        assert not await h.assert_distinct_values(dataset_id, "region", expected_regions), (
            "pre-assert op-1: region already in canonical set; nothing to standardize"
        )
        await h.chat_turn(
            "Standardize the region column to title case",
            dataset_id=dataset_id,
        )
        post_state_op1 = await h.get_table_state(dataset_id, preview_limit=100)
        post_regions = set(post_state_op1.df["region"].dropna())
        assert post_regions == expected_regions, (
            f"post-assert op-1: region not in canonical set {sorted(expected_regions)!r}; got {sorted(post_regions)!r}"
        )

        # ----- Op 2: fix typo + standardize category ------------------------
        expected_categories = {"Electronics", "Apparel", "Home Goods", "Books", "Toys"}
        # Typo presence has no harness predicate equivalent — keep inline.
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        assert any(
            isinstance(row.get("product_category"), str) and "Electornics" in row["product_category"]
            for row in pre.preview
        ), "pre-assert op-2: 'Electornics' typo not present in product_category; fixture has no typo to fix"
        assert not await h.assert_distinct_values(dataset_id, "product_category", expected_categories), (
            "pre-assert op-2: product_category already in canonical set"
        )
        await h.chat_turn(
            'The product category has typos — fix "Electornics" to '
            '"Electronics" and standardize everything to title case',
            dataset_id=dataset_id,
        )
        assert await h.assert_distinct_values(dataset_id, "product_category", expected_categories), (
            f"post-assert op-2: product_category not in canonical set {sorted(expected_categories)!r}"
        )

        # ----- Op 3: standardize payment_method -----------------------------
        raw_payment_variants = {"credit_card", "credit-card", "CREDIT_CARD", "paypal", "apple_pay", "bank_transfer"}
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        pre_payments = set(pre.df["payment_method"].dropna())
        assert raw_payment_variants & pre_payments, (
            f"pre-assert op-3: no raw payment_method variants present; got {sorted(pre_payments)!r}"
        )
        await h.chat_turn(
            'Standardize payment_method to a single canonical form per method (e.g. "Credit Card" not "credit_card")',
            dataset_id=dataset_id,
        )
        # The exact canonical form is LLM-chosen; assert the cardinality + that
        # the historical raw variants have collapsed.
        post = await h.get_table_state(dataset_id)
        post_payments = set(post.df["payment_method"].dropna())
        assert len(post_payments) <= 5, (
            f"post-assert op-3: payment_method should collapse to ≤ 5 distinct values, got {sorted(post_payments)!r}"
        )
        leftover_variants = raw_payment_variants & post_payments
        assert not leftover_variants, (
            f"post-assert op-3: raw payment_method variants still present: {sorted(leftover_variants)!r}"
        )

        # ----- Op 4: standardize shipping_status to title case --------------
        expected_shipping = {"Delivered", "Pending", "Shipped", "Cancelled"}
        assert not await h.assert_distinct_values(dataset_id, "shipping_status", expected_shipping), (
            "pre-assert op-4: shipping_status already in canonical set"
        )
        await h.chat_turn(
            "Standardize shipping_status to title case",
            dataset_id=dataset_id,
        )
        assert await h.assert_distinct_values(dataset_id, "shipping_status", expected_shipping), (
            f"post-assert op-4: shipping_status not in canonical set {sorted(expected_shipping)!r}"
        )

        # ----- Op 5: strip $ from unit_price + convert to number ------------
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        assert _str_values(pre, "unit_price").str.lstrip().str.startswith("$").any(), (
            "pre-assert op-5: no unit_price has $ prefix; fixture has nothing to strip"
        )
        await h.chat_turn(
            "Strip the dollar sign from unit_price and convert it to a number",
            dataset_id=dataset_id,
        )
        post = await h.get_table_state(dataset_id)
        post_unit_strs = _str_values(post, "unit_price")
        leftover_dollars = post_unit_strs[post_unit_strs.str.lstrip().str.startswith("$")]
        assert leftover_dollars.empty, (
            f"post-assert op-5: unit_price still has $ prefix on {len(leftover_dollars)} rows: "
            f"{leftover_dollars.head().tolist()!r}"
        )

        # ----- Op 6: convert order_date to ISO ------------------------------
        pre = await h.get_table_state(dataset_id, preview_limit=100)
        assert _str_values(pre, "order_date").str.contains("/").any(), (
            "pre-assert op-6: no order_date has slash (US) format; fixture has nothing to convert"
        )
        await h.chat_turn(
            "The order_date column has two different formats. Convert everything to ISO format (YYYY-MM-DD)",
            dataset_id=dataset_id,
        )
        post = await h.get_table_state(dataset_id)
        post_dates = _str_values(post, "order_date")
        post_dates = post_dates[post_dates != ""]
        leftover_slashes = post_dates[post_dates.str.contains("/")]
        assert leftover_slashes.empty, (
            f"post-assert op-6: order_date still has US-format slash on {len(leftover_slashes)} rows: "
            f"{leftover_slashes.head().tolist()!r}"
        )
        non_iso = post_dates[~post_dates.str.match(r"^\d{4}-\d{2}-\d{2}")]
        assert non_iso.empty, (
            f"post-assert op-6: order_date not in ISO YYYY-MM-DD form on {len(non_iso)} rows: "
            f"{non_iso.head().tolist()!r}"
        )

        # ----- Op 7: fill missing discount_pct with 0 -----------------------
        assert await h.assert_has_nulls(dataset_id, "discount_pct"), (
            "pre-assert op-7: discount_pct has no null/empty values; fixture has nothing to fill"
        )
        await h.chat_turn(
            "Fill missing values in discount_pct with 0",
            dataset_id=dataset_id,
        )
        assert not await h.assert_has_nulls(dataset_id, "discount_pct"), (
            "post-assert op-7: discount_pct still has null/empty values after fill"
        )

        # NOTE: ops 9-10 (count by region / product_category) were removed in
        # dc-9u1. A client-side reduce over the preview window never exercised
        # the agent path, so asserting `sum() == 250` was structurally
        # orthogonal to whether chat did anything. Aggregations belong in
        # views/reports (separate epic), not the staging layer's product
        # contract.

    elapsed = time.monotonic() - started
    assert elapsed <= WALL_CLOCK_BUDGET_SECONDS, (
        f"AC1.6 wall-clock budget exceeded: {elapsed:.1f}s > {WALL_CLOCK_BUDGET_SECONDS}s"
    )
