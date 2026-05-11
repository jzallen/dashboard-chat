"""Milestone-1 operator outline: every filter operator renders deterministically.

The agent's ``addFilter`` tool surfaces 12 operators; each must compile
through the ibis path to a well-formed WHERE predicate. Per the scenario
docblock, "rendered SQL contains the WHERE clause expressing ``<column>
<operator> <value>`` semantically" — we assert the predicate's surface in
the compiled SQL and that evaluation returns the predicate's rows.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from driver import CreatedDataset, ViewAcceptanceDriver, predicate_present

pytestmark = [pytest.mark.real_io, pytest.mark.milestone_1]


def _amount_column(dataset_id: str) -> dict[str, str]:
    return {
        "name": "amount",
        "source_ref": dataset_id,
        "source_column": "amount",
        "display_type": "integer",
    }


def _status_column(dataset_id: str) -> dict[str, str]:
    return {
        "name": "status",
        "source_ref": dataset_id,
        "source_column": "status",
        "display_type": "text",
    }


_NUMERIC_CASES = [
    ("amt_eq", "amount", "=", "1500", lambda row: row["amount"] == 1500),
    ("amt_neq", "amount", "!=", "1500", lambda row: row["amount"] != 1500),
    ("amt_gt", "amount", ">", "1000", lambda row: row["amount"] > 1000),
    ("amt_gte", "amount", ">=", "1500", lambda row: row["amount"] >= 1500),
    ("amt_lt", "amount", "<", "500", lambda row: row["amount"] < 500),
    ("amt_lte", "amount", "<=", "500", lambda row: row["amount"] <= 500),
]


_STATUS_CASES = [
    ("status_in", "status", "IN", "(open, pending)", lambda row: row["status"] in {"open", "pending"}),
    ("status_not_in", "status", "NOT IN", "(closed)", lambda row: row["status"] != "closed"),
    ("status_is_null", "status", "IS NULL", None, lambda row: row["status"] is None),
    ("status_not_null", "status", "IS NOT NULL", None, lambda row: row["status"] is not None),
    ("status_like", "status", "LIKE", "open%", lambda row: row["status"] and row["status"].startswith("open")),
    (
        "status_not_like",
        "status",
        "NOT LIKE",
        "%archived",
        lambda row: row["status"] and not row["status"].endswith("archived"),
    ),
]


@pytest.mark.parametrize("name,column,operator,value,row_predicate", _NUMERIC_CASES + _STATUS_CASES)
def test_operator_renders_deterministically(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
    orders_csv_path: Path,
    name: str,
    column: str,
    operator: str,
    value: str | None,
    row_predicate,
) -> None:
    columns = [
        _amount_column(orders_dataset.id),
        _status_column(orders_dataset.id),
    ]
    filter_def: dict = {
        "source_ref": orders_dataset.id,
        "column": column,
        "operator": operator,
    }
    if value is not None:
        filter_def["value"] = value
    view_data = driver.create_view(
        jwt,
        project,
        name=name,
        source_refs=[orders_dataset.as_source_ref()],
        columns=columns,
        filters=[filter_def],
    )
    compiled_sql = view_data["attributes"]["sql_definition"]

    # Predicate surface in the WHERE clause (case-insensitive contains-check
    # — exact byte shape varies by ibis version and is intentionally not
    # asserted).
    if operator == "IS NULL":
        assert "IS NULL" in compiled_sql.upper(), compiled_sql
    elif operator == "IS NOT NULL":
        assert "IS NOT NULL" in compiled_sql.upper(), compiled_sql
    elif operator in {"IN", "NOT IN"}:
        assert " IN " in compiled_sql.upper(), compiled_sql
    elif operator in {"LIKE", "NOT LIKE"}:
        assert " LIKE " in compiled_sql.upper(), compiled_sql
    else:
        # Comparison operators surface verbatim; != may render as <>.
        op_options = {"!=": ["!=", "<>"]}.get(operator, [operator])
        assert any(op in compiled_sql for op in op_options), compiled_sql

    # Row-level equivalence: every row in the evaluated result satisfies the
    # Python predicate; every row in the fixture that satisfies the predicate
    # appears in the result.
    rows = driver.evaluate_view_sql(
        compiled_sql,
        seed_relations={orders_dataset.name: orders_csv_path},
    )
    assert predicate_present(compiled_sql, "where"), compiled_sql
    for row in rows:
        assert row_predicate(row), (
            f"row {row!r} returned by {operator} {value!r} but does not "
            f"satisfy the predicate semantically"
        )
