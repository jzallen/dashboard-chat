"""Milestone-2 (MR-3) composition contract — two dimensions + three measures.

Drives the multi-dim / multi-measure composition scenario from
``docs/feature/ibis-as-only-sql-compiler/distill/milestone-2-report-ibis-compiler.feature``:

    Scenario: Two dimensions and three measures compose into a correctly
        aggregated report

The contract this test pins (per the feature file's §4 composition rationale):
*Composition is the contract; each measure's aggregation behaves independently
against the same row set.* The two dimensions land as ``GROUP BY "region",
"quarter"`` and the three measures (count on ``order_id``, sum on ``amount``,
avg on ``amount``) each get their own deterministic alias derived from
``columns_metadata[entry].name`` — explicitly NOT from the source column, so
``sum(amount)`` and ``avg(amount)`` round-trip with distinct projected names.

Per DWD-1 Strategy C the suite skips cleanly when the compose stack is
unreachable; the GREEN gate at this step is satisfied by the unit tests in
``backend/tests/use_cases/report/test_report_ibis_compiler.py`` when the stack
is down.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from driver import CreatedDataset, ViewAcceptanceDriver, predicate_present

pytestmark = [pytest.mark.real_io, pytest.mark.milestone_2]


def test_two_dimensions_and_three_measures_compose_into_aggregated_report_sql(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
    orders_csv_path: Path,
) -> None:
    orders_ref = orders_dataset.as_source_ref()

    report_data = driver.create_report(
        jwt,
        project,
        name="regional_quarterly_summary",
        report_type="fact",
        source_refs=[orders_ref],
        columns_metadata=[
            {
                "name": "region",
                "semantic_role": "dimension",
                "semantic_type": "categorical",
                "source_column": "region",
                "source_ref": orders_dataset.id,
            },
            {
                "name": "quarter",
                "semantic_role": "dimension",
                "semantic_type": "categorical",
                "source_column": "quarter",
                "source_ref": orders_dataset.id,
            },
            {
                "name": "order_count",
                "semantic_role": "measure",
                "semantic_type": "count",
                "source_column": "order_id",
                "source_ref": orders_dataset.id,
            },
            {
                "name": "amount_sum",
                "semantic_role": "measure",
                "semantic_type": "sum",
                "source_column": "amount",
                "source_ref": orders_dataset.id,
            },
            {
                "name": "amount_avg",
                "semantic_role": "measure",
                "semantic_type": "avg",
                "source_column": "amount",
                "source_ref": orders_dataset.id,
            },
        ],
    )

    # 1. The compiled report SQL groups by BOTH dimensions and contains
    #    every measure's aggregation expression.
    compiled_sql = report_data["attributes"]["sql_definition"]
    assert predicate_present(compiled_sql, "group by"), (
        f"compiled SQL is missing a GROUP BY clause:\n{compiled_sql}"
    )
    assert predicate_present(compiled_sql, '"region"'), (
        f"compiled SQL does not project the region dimension:\n{compiled_sql}"
    )
    assert predicate_present(compiled_sql, '"quarter"'), (
        f"compiled SQL does not project the quarter dimension:\n{compiled_sql}"
    )
    assert predicate_present(compiled_sql, "count(", "order_id"), (
        f"compiled SQL does not contain a count over order_id:\n{compiled_sql}"
    )
    assert predicate_present(compiled_sql, "sum(", "amount"), (
        f"compiled SQL does not contain a sum over amount:\n{compiled_sql}"
    )
    assert predicate_present(compiled_sql, "avg(", "amount"), (
        f"compiled SQL does not contain an avg over amount:\n{compiled_sql}"
    )
    # Same-source-column multi-measure: avg(amount) and sum(amount) must
    # surface with their own distinct output aliases derived from the
    # columns_metadata[entry].name field.
    assert predicate_present(compiled_sql, '"amount_sum"'), (
        f"compiled SQL is missing the sum measure's alias:\n{compiled_sql}"
    )
    assert predicate_present(compiled_sql, '"amount_avg"'), (
        f"compiled SQL is missing the avg measure's alias:\n{compiled_sql}"
    )

    # 2. Evaluating the compiled SQL against the orders fixture returns one
    #    row per distinct (region, quarter) pair with each measure computed
    #    independently. Use set-equality on {(region, quarter): {...}} —
    #    do NOT assert row order, ibis/DuckDB do not guarantee one.
    rows = driver.evaluate_report_sql(
        compiled_sql,
        seed_relations={orders_dataset.name: orders_csv_path},
    )
    actual_by_pair: dict[tuple[str, str], dict[str, float]] = {}
    for row in rows:
        key = (row["region"], row["quarter"])
        actual_by_pair[key] = {
            "order_count": row["order_count"],
            "amount_sum": float(row["amount_sum"]),
            "amount_avg": float(row["amount_avg"]),
        }

    expected_by_pair = _expected_aggregates_from_fixture(orders_csv_path)
    assert set(actual_by_pair.keys()) == set(expected_by_pair.keys()), (
        f"group-by partition mismatch: expected={set(expected_by_pair.keys())!r} "
        f"actual={set(actual_by_pair.keys())!r}"
    )
    for key, expected in expected_by_pair.items():
        actual = actual_by_pair[key]
        assert actual["order_count"] == expected["order_count"], (
            f"count mismatch at {key}: expected={expected['order_count']} actual={actual['order_count']}"
        )
        assert _close(actual["amount_sum"], expected["amount_sum"]), (
            f"sum mismatch at {key}: expected={expected['amount_sum']} actual={actual['amount_sum']}"
        )
        assert _close(actual["amount_avg"], expected["amount_avg"]), (
            f"avg mismatch at {key}: expected={expected['amount_avg']} actual={actual['amount_avg']}"
        )


# ---------------------------------------------------------------------------
# Fixture-derived expected values
# ---------------------------------------------------------------------------


def _expected_aggregates_from_fixture(csv_path: Path) -> dict[tuple[str, str], dict[str, float]]:
    """Read the orders fixture and compute the per-(region, quarter) expected
    aggregates straight from the source rows.

    Deriving expectations from the fixture rather than hardcoding them keeps
    the test resilient to fixture extension — adding rows for a new quarter
    automatically participates in the assertion without test edits. This is
    NOT circular verification of the compiler: we derive expectations from
    the CSV (the *data*), not from any production code that compiles SQL.
    """
    import csv

    expected: dict[tuple[str, str], dict[str, float]] = {}
    counts: dict[tuple[str, str], int] = {}
    sums: dict[tuple[str, str], float] = {}
    with csv_path.open() as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            key = (row["region"], row["quarter"])
            counts[key] = counts.get(key, 0) + 1
            sums[key] = sums.get(key, 0.0) + float(row["amount"])
    for key, total_count in counts.items():
        total_sum = sums[key]
        expected[key] = {
            "order_count": total_count,
            "amount_sum": total_sum,
            "amount_avg": total_sum / total_count,
        }
    return expected


def _close(a: float, b: float, *, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))
