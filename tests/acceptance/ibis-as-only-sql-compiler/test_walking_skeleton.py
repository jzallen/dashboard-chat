"""Walking-skeleton acceptance — gates MR-1 GREEN.

The simplest customer journey through the ibis-compiled view path: an
analyst creates a ``west_orders`` view with a single ``region = 'west'``
filter, and the customer sees the same filter in their dbt export.

Three assertions per DWD-3:
  1. The compiled view SQL contains a WHERE clause restricting ``region``
     to ``'west'``.
  2. The customer's dbt export contains an intermediate model whose SQL
     also restricts ``region`` to ``'west'``.
  3. Evaluating the compiled view against the orders fixture returns only
     the ``west`` rows.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from driver import CreatedDataset, ViewAcceptanceDriver, predicate_present

pytestmark = [pytest.mark.real_io, pytest.mark.walking_skeleton]


def test_walking_skeleton_filter_round_trips_into_dbt_eject(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
    orders_csv_path: Path,
) -> None:
    ds_ref = orders_dataset.as_source_ref()

    view_data = driver.create_view(
        jwt,
        project,
        name="west_orders",
        source_refs=[ds_ref],
        columns=[
            {
                "name": "order_id",
                "source_ref": orders_dataset.id,
                "source_column": "order_id",
                "display_type": "text",
            },
            {
                "name": "region",
                "source_ref": orders_dataset.id,
                "source_column": "region",
                "display_type": "text",
            },
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

    # 1. The compiled view SQL contains a WHERE clause restricting region.
    compiled_sql = view_data["attributes"]["sql_definition"]
    assert predicate_present(compiled_sql, "where", '"region"', "'west'"), (
        f"compiled SQL is missing WHERE region='west':\n{compiled_sql}"
    )

    # 2. The dbt export's intermediate model also restricts region.
    zip_bytes = driver.export_dbt_zip(jwt, project)
    intermediate_sql = driver.read_intermediate_sql(zip_bytes, "west_orders")
    assert predicate_present(intermediate_sql, "where", '"region"', "'west'"), (
        f"dbt intermediate SQL is missing WHERE region='west':\n{intermediate_sql}"
    )
    # And references the upstream "orders" model through a dbt ref macro.
    assert "{{ ref('stg_" in intermediate_sql, intermediate_sql

    # 3. Evaluating the compiled view against the orders fixture returns only
    #    the "west" rows.
    rows = driver.evaluate_view_sql(
        compiled_sql,
        seed_relations={orders_dataset.name: orders_csv_path},
    )
    assert rows, "expected non-empty result set after filtering on region='west'"
    assert {row["region"] for row in rows} == {"west"}, rows
