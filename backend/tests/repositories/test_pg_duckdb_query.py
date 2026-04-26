"""Unit tests for the pg_duckdb asyncpg-protocol workaround helpers.

Regression for dc-f8m: pg_duckdb's Describe phase reports a single column
for ``read_parquet`` queries while Execute returns the actual N columns,
which trips asyncpg's protocol parser. ``build_read_parquet_preview_query``
projects every row through ``to_json`` so Describe and Execute both see one
column. The exact SQL shape matters — ``to_json`` must apply to the direct
alias of ``read_parquet`` (not a subquery alias) so pg_duckdb's planner
binds it correctly.
"""

import json

from app.repositories.lake._pg_duckdb_query import (
    build_read_parquet_preview_query,
    decode_wrapped_rows,
)


class TestBuildReadParquetPreviewQuery:
    def test_uses_direct_alias_on_read_parquet_not_subquery(self):
        sql = build_read_parquet_preview_query("s3://bucket/file.parquet", limit=5)
        # The proven-working form: to_json applied to the direct alias of
        # read_parquet (no subquery in between). This is the structural
        # property that prevents the binder error.
        assert sql == "SELECT to_json(t) AS row FROM read_parquet('s3://bucket/file.parquet') t LIMIT 5"

    def test_produces_single_row_column_alias(self):
        # decode_wrapped_rows reads ``r["row"]`` — the alias must match.
        sql = build_read_parquet_preview_query("s3://b/f", limit=1)
        assert " AS row " in sql

    def test_includes_limit_in_query(self):
        sql = build_read_parquet_preview_query("s3://b/f", limit=42)
        assert "LIMIT 42" in sql


class TestDecodeWrappedRows:
    def test_decodes_each_row_json_into_dict(self):
        wrapped_rows = [
            {"row": json.dumps({"name": "Alice", "age": 30, "active": True})},
            {"row": json.dumps({"name": "Bob", "age": 25, "active": False})},
        ]
        decoded = decode_wrapped_rows(wrapped_rows)
        assert decoded == [
            {"name": "Alice", "age": 30, "active": True},
            {"name": "Bob", "age": 25, "active": False},
        ]

    def test_empty_rows_returns_empty_list(self):
        assert decode_wrapped_rows([]) == []
