"""Unit test for OrdersStaging schema two-sided range on quantity.

Phase 3 of distill/roadmap.json tightens `quantity` from a one-sided
`>= 0` check to a two-sided `in_range(min_value=1, max_value=10000)`.
The upper bound makes range-on-quantity a true two-sided constraint
per the roadmap (the dbt schema.yml exporter's `accepted_range` test
mirrors this).
"""

from __future__ import annotations

import pandas as pd
import pandera.errors as pa_errors
import pytest

from tests.integration.dataset_layer.validation.schemas.orders_staging import (
    OrdersStaging,
)


def _frame_with_quantity(quantity: int) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "region": ["North"],
            "customer_email": ["customer@example.com"],
            "product_category": ["category-a"],
            "quantity": [quantity],
        }
    )


class TestOrdersStagingQuantityRange:
    def test_quantity_above_upper_bound_fails_validation(self) -> None:
        df = _frame_with_quantity(20000)

        with pytest.raises(pa_errors.SchemaErrors) as excinfo:
            OrdersStaging.validate(df, lazy=True)

        # The failure_cases frame should mention the quantity column.
        failure_cases = excinfo.value.failure_cases
        assert "quantity" in set(failure_cases["column"].dropna().tolist()), (
            f"expected quantity violation, got: {failure_cases.to_dict('records')!r}"
        )

    def test_quantity_within_range_passes_validation(self) -> None:
        df = _frame_with_quantity(5)

        # Should not raise.
        OrdersStaging.validate(df, lazy=True)
