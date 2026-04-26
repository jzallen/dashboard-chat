"""Helpers for issuing pg_duckdb multi-column reads through asyncpg.

pg_duckdb's prepared-statement Describe phase reports a single column for
``read_parquet`` queries while Execute returns the actual N columns. asyncpg's
extended protocol always issues Describe (even with the prepared-statement
cache disabled), so it raises ``ProtocolError: the number of columns in the
result row (N) is different from what was described (1)`` for multi-column
reads.

The workaround is to project every row into a single ``to_json`` column so
Describe and Execute both see one column. Two important constraints:

1. The ``to_json`` call must reference the **direct alias** of ``read_parquet``
   (e.g. ``FROM read_parquet('s3://...') t``). Wrapping the query in a
   subquery (``FROM (SELECT * FROM read_parquet(...)) t``) makes pg_duckdb's
   planner expand ``t`` into ``t.*`` and then DuckDB's binder rejects
   ``to_json(col_a, col_b, ...)`` with "takes exactly one argument".
2. **Single-column queries are not affected.** Describe and Execute already
   agree at one column, so single-column ``conn.fetch`` calls work without
   any wrapping. Use ``conn.fetchrow``/``conn.fetch`` directly for those.

This is the smallest blast-radius fix for dc-f8m. Switching to psycopg3 (which
supports ``execute(..., prepare=False)`` and so can use the simple-query
protocol directly) is the long-term direction; see dc-f8m for trade-offs.
"""

import json
from typing import Any


def build_read_parquet_preview_query(s3_path: str, limit: int) -> str:
    """Build a ``SELECT *``-equivalent preview query that returns one JSON column per row.

    The result of executing this query has a single ``row`` column whose values
    are JSON strings encoding the original parquet row. Decode with
    :func:`decode_wrapped_rows`.

    The exact SQL shape matters — ``to_json`` must apply to the direct alias
    of ``read_parquet`` for pg_duckdb's planner to bind it correctly.
    """
    return f"SELECT to_json(t) AS row FROM read_parquet('{s3_path}') t LIMIT {limit}"


def decode_wrapped_rows(rows: list[Any]) -> list[dict[str, Any]]:
    """Decode rows returned from a ``to_json``-wrapped query.

    Each input row has a single ``row`` column whose value is a JSON string
    encoding the original row. Returns a list of dicts.
    """
    return [json.loads(r["row"]) for r in rows]
