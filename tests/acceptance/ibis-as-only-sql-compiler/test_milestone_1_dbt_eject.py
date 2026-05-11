"""Milestone-1 dbt-eject equivalence.

Scenario: the customer downloads the dbt project export. The intermediate
model corresponding to the analyst's view restricts the same predicate the
in-system compiled SQL restricts. Evaluating the intermediate model against
seeded data returns the same rows the legacy generator's SQL would have
returned for the same view definition (per ADR-026 §"Decision drivers →
dbt eject fidelity").
"""

from __future__ import annotations

from pathlib import Path

import pytest

from driver import CreatedDataset, ViewAcceptanceDriver, predicate_present

pytestmark = [pytest.mark.real_io, pytest.mark.milestone_1]


def test_dbt_export_intermediate_model_filters_match(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
    orders_csv_path: Path,
) -> None:
    view_data = driver.create_view(
        jwt,
        project,
        name="west_high_value_orders",
        source_refs=[orders_dataset.as_source_ref()],
        columns=[
            {
                "name": "order_id",
                "source_ref": orders_dataset.id,
                "source_column": "order_id",
                "display_type": "text",
                "alias": "order_id",
            },
            {
                "name": "amount",
                "source_ref": orders_dataset.id,
                "source_column": "amount",
                "display_type": "integer",
                "alias": "amount",
            },
        ],
        filters=[
            {
                "source_ref": orders_dataset.id,
                "column": "region",
                "operator": "=",
                "value": "west",
            },
            {
                "source_ref": orders_dataset.id,
                "column": "amount",
                "operator": ">",
                "value": "1000",
            },
        ],
    )
    compiled_sql = view_data["attributes"]["sql_definition"]

    zip_bytes = driver.export_dbt_zip(jwt, project)
    intermediate_sql = driver.read_intermediate_sql(zip_bytes, "west_high_value_orders")

    # Same predicates appear in the customer-visible dbt model.
    assert predicate_present(intermediate_sql, "where", "'west'", "1000")
    # Reference is to the upstream "orders" model via dbt ref macro.
    assert "{{ ref('stg_" in intermediate_sql

    # Evaluating the intermediate SQL — with stg_<orders> rewired to the
    # fixture relation — must return the same rows the compiled view returns.
    stg_name = f"stg_{orders_dataset.name.lower().replace(' ', '_')}"
    # Replace the dbt ref macro with a real DuckDB table reference so the
    # SQL is executable against the fixture.
    executable = intermediate_sql.replace(f"{{{{ ref('{stg_name}') }}}}", f'"{stg_name}"')
    # Strip the dbt config block — DuckDB ignores ``{{ config(...) }}`` and
    # we treat it as a Jinja comment by removing the line.
    executable = "\n".join(
        line for line in executable.splitlines() if not line.lstrip().startswith("{{ config")
    )

    view_rows = driver.evaluate_view_sql(
        compiled_sql,
        seed_relations={orders_dataset.name: orders_csv_path},
    )
    intermediate_rows = driver.evaluate_view_sql(
        executable,
        seed_relations={stg_name: orders_csv_path},
    )
    # Order may differ — compare as sets of frozensets of items.
    view_set = {frozenset(r.items()) for r in view_rows}
    intermediate_set = {frozenset(r.items()) for r in intermediate_rows}
    assert view_set == intermediate_set, (
        f"compiled view and dbt-ejected intermediate model diverge:\n"
        f"view rows: {view_rows}\nintermediate rows: {intermediate_rows}"
    )
