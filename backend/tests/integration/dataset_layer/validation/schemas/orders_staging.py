"""Orders staging Pandera schema for per-turn validation.

Mirrors the dbt staging model name from the exported project's
`models/staging/stg_orders.sql`. Two SSOTs for the same shape until
Atlas's deferred translator lands (design.md §13 risk #5); the eject
step IS the drift detector between them.

Phase 0 minimal coverage — sufficient for the walking-skeleton fixture
under `tests/acceptance/dbt-test-validation/`. Distill Phase 3 deepens
the schema (additional columns, cross-column constraints, nullability).
"""

from __future__ import annotations

import re

import pandera.pandas as pa

_ACCEPTED_REGIONS = frozenset({"North", "South", "East", "West"})
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


OrdersStaging = pa.DataFrameSchema(
    columns={
        "region": pa.Column(
            str,
            checks=pa.Check.isin(
                _ACCEPTED_REGIONS,
                error="invalid region (expected one of North/South/East/West)",
            ),
            nullable=False,
        ),
        "customer_email": pa.Column(
            str,
            checks=pa.Check.str_matches(
                _EMAIL_PATTERN,
                error="invalid customer_email format",
            ),
            nullable=False,
        ),
        "product_category": pa.Column(
            str,
            checks=pa.Check.str_matches(
                re.compile(r"^\S(.*\S)?$"),
                error="product_category has leading or trailing whitespace",
            ),
            nullable=False,
        ),
        "quantity": pa.Column(
            int,
            # Two-sided range: the upper bound (10000) is a defensible domain
            # cap — any single-line-item quantity above it is almost certainly
            # data corruption, not a genuine bulk order. Mirrors the
            # accepted_range dbt test the schema.yml exporter would emit.
            checks=pa.Check.in_range(min_value=1, max_value=10000),
            nullable=False,
        ),
    },
    strict=False,
    coerce=False,
)
