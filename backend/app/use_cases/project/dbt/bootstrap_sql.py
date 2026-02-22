from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.dataset import Dataset

# S3 path components: alphanumeric, hyphens, underscores, dots, slashes.
# Rejects single quotes, backslashes, semicolons — anything that could
# break out of a SQL string literal.
_SAFE_S3_PATH_RE = re.compile(r"^[a-zA-Z0-9._/\-]+$")


def _quote_ident(name: str) -> str:
    """Double-quote a SQL identifier, escaping embedded double-quotes."""
    return '"' + name.replace('"', '""') + '"'


def _validate_s3_path(path: str) -> str:
    """Validate an S3 path component contains only safe characters.

    Raises ValueError if the path contains characters that could break
    out of a SQL string literal (single quotes, backslashes, semicolons).
    """
    if not _SAFE_S3_PATH_RE.match(path):
        raise ValueError(f"Invalid S3 path component: {path!r}")
    return path


def generate_bootstrap_sql(
    schema_name: str,
    datasets: list[tuple[str, Dataset]],
    bucket: str,
) -> str:
    """Generate bootstrap SQL to create views over S3 parquet in pg_duckdb.

    Creates a schema, drops stale views, and creates one view per dataset
    that reads from parquet files in S3 via read_parquet().
    Everything is wrapped in a transaction for atomicity.

    All identifiers are double-quoted to handle reserved words (e.g. 'select',
    'order') and maintain defense-in-depth against injection.
    All string literals are properly escaped via _quote_literal().
    """
    qs = _quote_ident(schema_name)  # quoted schema

    lines: list[str] = []
    lines.append("BEGIN;")
    lines.append("")
    lines.append(f"CREATE SCHEMA IF NOT EXISTS {qs};")
    lines.append("")

    # Drop all existing views in the schema for sync cleanup.
    # Uses format(%I) for the DROP and quote_literal() for the WHERE filter
    # so identifiers and literals are consistently escaped.
    lines.append("DO $$")
    lines.append("DECLARE r RECORD;")
    lines.append("BEGIN")
    lines.append(
        f"  FOR r IN SELECT table_name FROM information_schema.views"
        f" WHERE table_schema = {_quote_literal(schema_name)}"
    )
    lines.append("  LOOP")
    lines.append(
        f"    EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE',"
        f" {_quote_literal(schema_name)}, r.table_name);"
    )
    lines.append("  END LOOP;")
    lines.append("END $$;")

    for snake_name, dataset in datasets:
        qv = _quote_ident(snake_name)  # quoted view name
        # Validate and escape the S3 URI as a SQL literal
        _validate_s3_path(bucket)
        _validate_s3_path(dataset.storage_path)
        s3_uri = f"s3://{bucket}/{dataset.storage_path}**/*.parquet"
        lines.append("")
        lines.append(
            f"CREATE OR REPLACE VIEW {qs}.{qv} AS"
        )
        lines.append(
            f"  SELECT * FROM read_parquet({_quote_literal(s3_uri)});"
        )

    lines.append("")
    lines.append("COMMIT;")
    return "\n".join(lines)


def _quote_literal(value: str) -> str:
    """Single-quote a SQL literal, escaping embedded single-quotes."""
    return "'" + value.replace("'", "''") + "'"
