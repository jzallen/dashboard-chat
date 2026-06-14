"""Unit tests for ``title_case_label`` — the display-name humanizer.

Port-to-port at domain scope: ``title_case_label`` is a pure function whose
signature IS its driving port. Each case asserts the observable return value.
"""

import pytest

from app.use_cases.dataset._pipeline.ingestion import stg_model_name, title_case_label


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("customers.csv", "Customers"),
        ("orders_csv", "Orders Csv"),
        ("q1-revenue.xlsx", "Q1 Revenue"),
        ("sales_q1_2024.csv", "Sales Q1 2024"),
        ("multi   space.csv", "Multi Space"),
        ("  padded-name.tsv  ", "Padded Name"),
        ("no_extension_here", "No Extension Here"),
        ("data.parquet", "Data Parquet"),
        ("", "New Dataset"),
        (".csv", "New Dataset"),
        ("___", "New Dataset"),
    ],
)
def test_title_case_label(raw, expected):
    assert title_case_label(raw) == expected


@pytest.mark.parametrize(
    "display_name,expected",
    [
        # The four canonical examples from the slice plan.
        ("Customers", "stg_customers"),
        ("Q1 Revenue", "stg_q1_revenue"),
        ("stg_orders", "stg_orders"),  # no double-prefix when already stg_
        ("", "stg_dataset"),  # empty folds to the to_snake_case fallback root
        # Punctuation / separator runs collapse to a single underscore.
        ("Sales — Q1 (2024)", "stg_sales_q1_2024"),
        ("Order Items!!!", "stg_order_items"),
        ("  Padded Name  ", "stg_padded_name"),
        # A bare ``stg`` token is NOT the ``stg_`` prefix — it still gets prefixed.
        ("stg", "stg_stg"),
    ],
)
def test_stg_model_name(display_name, expected):
    assert stg_model_name(display_name) == expected
