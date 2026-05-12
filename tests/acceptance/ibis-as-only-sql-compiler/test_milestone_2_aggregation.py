"""Milestone-2 (MR-3) aggregation contract — one dimension + one measure.

Drives the dormant ``addDimension`` / ``addMeasure`` dispatchers (per ADR-026
§"Decision outcome" item 2 and §"MR roadmap" → MR-3) through the customer-facing
HTTP path: ``POST /api/projects/{project_id}/reports`` with structured
``columns_metadata`` carrying ``role=dimension`` + ``role=measure`` entries.

Three assertions per the milestone-2 feature file's first scenario:
  1. The compiled report SQL groups results by ``region`` and contains a count
     expression on ``order_id``.
  2. The customer's dbt export contains a mart model whose SQL also groups by
     ``region``.
  3. Evaluating the compiled SQL against the orders fixture returns one row
     per distinct region with matching counts.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from driver import CreatedDataset, ViewAcceptanceDriver, predicate_present

pytestmark = [pytest.mark.real_io, pytest.mark.milestone_2]


def test_dimension_and_measure_aggregate_into_grouped_report_sql(
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
        name="orders_by_region",
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
                "name": "order_count",
                "semantic_role": "measure",
                "semantic_type": "count",
                "source_column": "order_id",
                "source_ref": orders_dataset.id,
            },
        ],
    )

    # 1. The compiled report SQL contains a GROUP BY restricting on region
    #    plus a count expression touching the order_id column.
    compiled_sql = report_data["attributes"]["sql_definition"]
    assert predicate_present(compiled_sql, "group by"), (
        f"compiled SQL is missing a GROUP BY clause:\n{compiled_sql}"
    )
    assert predicate_present(compiled_sql, '"region"'), (
        f"compiled SQL does not project the region dimension:\n{compiled_sql}"
    )
    assert predicate_present(compiled_sql, "count(", "order_id"), (
        f"compiled SQL does not contain a count over order_id:\n{compiled_sql}"
    )

    # 2. The dbt export's mart model also groups by region.
    zip_bytes = driver.export_dbt_zip(jwt, project)
    mart_sql = driver.read_mart_sql(zip_bytes, "orders_by_region")
    assert predicate_present(mart_sql, "group by"), (
        f"mart model SQL is missing a GROUP BY clause:\n{mart_sql}"
    )
    assert predicate_present(mart_sql, '"region"'), (
        f"mart model SQL does not project the region dimension:\n{mart_sql}"
    )
    assert predicate_present(mart_sql, "count(", "order_id"), (
        f"mart model SQL does not contain a count over order_id:\n{mart_sql}"
    )

    # 3. Evaluating the compiled SQL against the orders fixture returns one
    #    row per distinct region with matching counts. The orders.csv fixture
    #    has 4 west, 3 east, 2 central — count those independently.
    rows = driver.evaluate_report_sql(
        compiled_sql,
        seed_relations={orders_dataset.name: orders_csv_path},
    )
    counts_by_region = {row["region"]: row["order_count"] for row in rows}
    assert counts_by_region == {"west": 4, "east": 3, "central": 2}, (
        f"unexpected aggregation result: {counts_by_region}"
    )
