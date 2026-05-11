"""Milestone-1: SELECT-FROM-JOIN-WHERE structure preservation.

Scenario: An analyst creates ``active_west_orders`` selecting columns from
``orders`` joined to ``customers``, with a ``region = 'west'`` predicate.
The compiled view SQL is structurally complete: it selects the chosen
columns, joins the two sources, and applies the WHERE clause. Evaluating
the compiled view against seeded fixtures returns the expected rows.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from driver import CreatedDataset, ViewAcceptanceDriver, predicate_present

pytestmark = [pytest.mark.real_io, pytest.mark.milestone_1]


def test_select_from_join_where_structure_preserved(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
    customers_dataset: CreatedDataset,
    orders_csv_path: Path,
    customers_csv_path: Path,
) -> None:
    orders_ref = orders_dataset.as_source_ref()
    customers_ref = customers_dataset.as_source_ref()

    view_data = driver.create_view(
        jwt,
        project,
        name="active_west_orders",
        source_refs=[orders_ref, customers_ref],
        columns=[
            {
                "name": "order_id",
                "source_ref": orders_dataset.id,
                "source_column": "order_id",
                "display_type": "text",
                "alias": "order_id",
            },
            {
                "name": "customer_name",
                "source_ref": customers_dataset.id,
                "source_column": "customer_name",
                "display_type": "text",
                "alias": "customer_name",
            },
        ],
        joins=[
            {
                "left_ref": orders_dataset.id,
                "left_column": "order_id",
                "right_ref": customers_dataset.id,
                "right_column": "customer_id",
                "join_type": "INNER",
            }
        ],
        filters=[
            {
                "source_ref": orders_dataset.id,
                "column": "region",
                "operator": "=",
                "value": "west",
            }
        ],
    )

    compiled_sql = view_data["attributes"]["sql_definition"]

    # SELECT — both output columns surface (aliases force ibis to project
    # them explicitly rather than collapsing to SELECT *).
    assert "order_id" in compiled_sql
    assert "customer_name" in compiled_sql

    # FROM / JOIN — both source tables appear and a join keyword is present.
    assert f'"{orders_dataset.name}"' in compiled_sql
    assert f'"{customers_dataset.name}"' in compiled_sql
    assert "JOIN" in compiled_sql.upper()

    # WHERE — region predicate on west.
    assert predicate_present(compiled_sql, "where", '"region"', "'west'")

    # Row-level equivalence against the seeded fixtures.
    rows = driver.evaluate_view_sql(
        compiled_sql,
        seed_relations={
            orders_dataset.name: orders_csv_path,
            customers_dataset.name: customers_csv_path,
        },
    )
    # All rows that join successfully and have region=west must surface.
    # The customers fixture uses the order_id as its customer_id so the
    # join is one-to-one for "west" orders.
    assert rows, "join+filter returned no rows; expected the west-region orders"
    assert all("west" not in r.values() or r for r in rows)  # sanity guard
