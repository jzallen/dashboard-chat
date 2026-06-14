"""Unit tests for ``title_case_label`` — the display-name humanizer.

Port-to-port at domain scope: ``title_case_label`` is a pure function whose
signature IS its driving port. Each case asserts the observable return value.
"""

import pytest

from app.use_cases.dataset._pipeline.ingestion import title_case_label


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
