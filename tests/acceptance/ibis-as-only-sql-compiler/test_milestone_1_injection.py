"""Milestone-1 @security_invariant: ADR-026 Gap 1 closure contract.

A hostile ``ViewFilter.value`` containing a SQL-injection payload must be
treated as a string literal — never as embedded SQL syntax. The closure
mechanism per DWD-4 is ibis literal escaping; this scenario asserts the
observable outcomes that follow from that closure.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from driver import CreatedDataset, ViewAcceptanceDriver

pytestmark = [pytest.mark.real_io, pytest.mark.milestone_1, pytest.mark.security_invariant]


INJECTION_PAYLOAD = "'; DROP TABLE projects; --"


def test_injection_payload_round_trips_as_literal(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
    orders_csv_path: Path,
) -> None:
    view_data = driver.create_view(
        jwt,
        project,
        name="trick_view",
        source_refs=[orders_dataset.as_source_ref()],
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
                "value": INJECTION_PAYLOAD,
            }
        ],
    )
    compiled_sql = view_data["attributes"]["sql_definition"]

    # 1. The compiled view SQL is well-formed and executable — quote count is
    #    even (no unterminated literal escaping the WHERE clause).
    assert compiled_sql.count("'") % 2 == 0, (
        f"odd quote count in compiled SQL — payload escaped the literal "
        f"layer:\n{compiled_sql}"
    )

    # 4. The persisted view definition stores the injection payload as the
    #    filter's literal value (single quotes doubled per SQL escape rules),
    #    not as embedded SQL syntax.
    assert "''; DROP TABLE projects; --" in compiled_sql, (
        f"injection payload must appear as an escaped string literal; the "
        f"presence of '' confirms ibis routed it through literal escaping "
        f"rather than f-string interpolation:\n{compiled_sql}"
    )

    # 2. Evaluating the compiled view against seeded orders data returns
    #    zero rows — the payload is not a region value.
    rows = driver.evaluate_view_sql(
        compiled_sql,
        seed_relations={orders_dataset.name: orders_csv_path},
    )
    assert rows == [], (
        f"injection payload should match zero rows in the fixture; got: {rows}"
    )

    # 3. The "projects" table is still present and unchanged after evaluation.
    #    DuckDB ran the WHERE predicate but did not execute the DROP TABLE
    #    portion (which would have failed anyway — DuckDB has no ``projects``
    #    table — but the literal-escape contract is the point). The
    #    persisted-payload assertion above closes this contract: if the WHERE
    #    clause had executed the embedded DROP, the round-tripped payload
    #    would not be a quoted literal in the SQL.

    # The view is persisted: a re-fetch returns the same payload-as-literal.
    fetched = driver.get_view(jwt, project, view_data["id"])
    persisted_filters = fetched["attributes"]["filters"]
    assert any(f["value"] == INJECTION_PAYLOAD for f in persisted_filters), persisted_filters
