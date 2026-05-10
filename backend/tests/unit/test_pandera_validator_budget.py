"""Unit tests for PanderaValidator's timing-budget guard (Phase 3 of dbt-test-validation).

Phase 3 of distill/roadmap.json adds an `over_budget` flag on `ValidationResult`
and a `budget_ms` keyword parameter on `PanderaValidator.validate(...)`. The
typical per-turn budget is `<100ms` (design.md §6 OQ4); the acceptance-side
budget is 200ms (skill F-004's 2x typical-for-CI rule).

Behaviors covered (test budget: 2 behaviors x 2 = 4 unit tests max — under
budget here at 2):
1. validate() flips over_budget=True when elapsed_ms exceeds the supplied budget_ms.
2. validate() leaves over_budget=False under the default 200ms budget on a
   trivially-small frame.
"""

from __future__ import annotations

import pandas as pd

from tests.integration.dataset_layer.validation.pandera_validator import (
    PanderaValidator,
)
from tests.integration.dataset_layer.validation.schemas.orders_staging import (
    OrdersStaging,
)


def _one_row_clean_orders_frame() -> pd.DataFrame:
    """Build a 1-row shape-correct OrdersStaging frame."""
    return pd.DataFrame(
        {
            "region": ["North"],
            "customer_email": ["customer@example.com"],
            "product_category": ["category-a"],
            "quantity": [1],
        }
    )


class TestPanderaValidatorBudget:
    def test_validate_records_over_budget_when_elapsed_exceeds_budget_ms(self) -> None:
        validator = PanderaValidator()
        df = _one_row_clean_orders_frame()

        # 0.001ms is well below pandera's actual validate() wall-clock cost,
        # so any real call will exceed it.
        result = validator.validate(df, schema=OrdersStaging, budget_ms=0.001)

        assert result.status == "pass"
        assert result.over_budget is True, (
            f"expected over_budget=True when elapsed_ms ({result.elapsed_ms:.4f}) "
            f"exceeds budget_ms=0.001; got over_budget={result.over_budget!r}"
        )

    def test_validate_records_under_budget_when_default_budget(self) -> None:
        validator = PanderaValidator()
        df = _one_row_clean_orders_frame()

        result = validator.validate(df, schema=OrdersStaging)

        assert result.status == "pass"
        assert result.over_budget is False, (
            f"expected over_budget=False under default 200ms budget; "
            f"elapsed_ms={result.elapsed_ms:.2f}, "
            f"over_budget={result.over_budget!r}"
        )
