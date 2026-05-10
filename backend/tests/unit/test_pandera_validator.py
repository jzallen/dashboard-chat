"""Unit tests for PanderaValidator (per-turn shape validator).

Step 00-07 — Phase 0 walking-skeleton coverage for ADR-018 Option β.
The validator is a leaf utility; these unit tests serve as the acceptance
contract — no separate acceptance scenario is enabled at this step.

Behaviors covered (test budget: 3 behaviors x 2 = 6 unit tests max):
1. Pass path returns status="pass", empty errors, and stays under the
   200ms per-turn budget on a 100-row clean DataFrame.
2. Fail path returns status="fail" with a column-level error message
   identifying the offending column and value.
3. Multi-error collection: lazy=True surfaces every failing column in
   one validate() call (so retry-with-rephrase has full diagnostic
   context per ADR-018).
"""

from __future__ import annotations

import pandas as pd

from tests.integration.dataset_layer.validation.pandera_validator import (
    PanderaValidator,
    ValidationResult,
    serialize_diff,
)
from tests.integration.dataset_layer.validation.schemas.orders_staging import (
    OrdersStaging,
)


def _clean_orders_frame(rows: int = 100) -> pd.DataFrame:
    """Build a shape-correct OrdersStaging DataFrame for the pass path."""
    regions = ["North", "South", "East", "West"]
    return pd.DataFrame(
        {
            "region": [regions[i % 4] for i in range(rows)],
            "customer_email": [f"customer{i}@example.com" for i in range(rows)],
            "product_category": [f"category-{i % 5}" for i in range(rows)],
            # quantity is constrained to in_range(1, 10000); avoid 0.
            "quantity": [(i % 10) + 1 for i in range(rows)],
        }
    )


class TestPanderaValidator:
    def test_validator_returns_under_200ms_on_shape_correct_frame(self) -> None:
        validator = PanderaValidator()
        df = _clean_orders_frame(rows=100)

        result = validator.validate(df, schema=OrdersStaging)

        assert isinstance(result, ValidationResult)
        assert result.status == "pass"
        assert result.errors == []
        assert result.elapsed_ms < 200, f"validate() exceeded 200ms budget: {result.elapsed_ms:.2f}ms"

    def test_validator_reports_column_level_error_on_invalid_region(self) -> None:
        validator = PanderaValidator()
        df = _clean_orders_frame(rows=10)
        df.loc[0, "region"] = "south"  # lowercase — not in accepted_values

        result = validator.validate(df, schema=OrdersStaging)

        assert result.status == "fail"
        assert result.errors, "fail status must come with at least one error message"
        assert any("region" in err for err in result.errors), (
            f"expected error mentioning 'region', got: {result.errors}"
        )

    def test_validator_collects_errors_from_multiple_columns_in_one_pass(
        self,
    ) -> None:
        validator = PanderaValidator()
        df = _clean_orders_frame(rows=10)
        df.loc[0, "region"] = "south"  # bad region
        df.loc[1, "customer_email"] = "not-an-email"  # bad email

        result = validator.validate(df, schema=OrdersStaging)

        assert result.status == "fail"
        assert any("region" in err for err in result.errors), f"expected region error, got: {result.errors}"
        assert any("customer_email" in err for err in result.errors), (
            f"expected customer_email error, got: {result.errors}"
        )


class TestSerializeDiff:
    """Phase 5: serialize_diff converts a fail-status ValidationResult into a
    structured diff payload suitable for ``StructuredRetryExhaustion``.

    The harness's chat_turn carries this through to the exhausted-retries
    raise so callers (and the failure-context @then bindings) can introspect
    the failure shape, not just the formatted message.
    """

    def test_pass_result_serializes_to_empty_list(self) -> None:
        result = ValidationResult(status="pass", errors=[], elapsed_ms=1.0, over_budget=False)

        assert serialize_diff(result) == []

    def test_fail_result_parses_each_error_into_structured_entry(self) -> None:
        result = ValidationResult(
            status="fail",
            errors=[
                "region: failed check 'isin' (value='Mars')",
                "customer_email: failed check 'str_matches' (value='not-an-email')",
            ],
            elapsed_ms=2.0,
            over_budget=False,
        )

        diff = serialize_diff(result)

        assert diff == [
            {"column": "region", "check": "isin", "value": "'Mars'"},
            {"column": "customer_email", "check": "str_matches", "value": "'not-an-email'"},
        ]

    def test_unparseable_error_falls_through_with_raw_message(self) -> None:
        """A future Pandera version might emit a different format; the
        serializer keeps the raw string so the diff payload never silently
        drops information.
        """
        result = ValidationResult(
            status="fail",
            errors=["some unexpected error format that doesn't match"],
            elapsed_ms=1.0,
            over_budget=False,
        )

        diff = serialize_diff(result)

        assert len(diff) == 1
        assert diff[0]["raw"] == "some unexpected error format that doesn't match"
