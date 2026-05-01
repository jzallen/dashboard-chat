"""SQL compilation for Dataset transforms.

This module owns the *SQL-generation* responsibility previously embedded in
``Dataset``. It turns a dataset's ``name`` + ``schema_config`` + ``transforms``
into either compact staging SQL (for query execution) or display SQL (pretty,
human-readable). Nothing here reads from or writes to a database; Ibis is used
as a compiler only.

Pipeline (design D3):
    1. MUTATE  — clean/map transforms applied as column expressions (sorted by created_at)
    2. FILTER  — filter transforms applied as WHERE predicates
    3. RENAME  — alias transforms applied as column renames
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

import ibis

from ..types import CleaningExpression
from .transform import Transform

# Maps dataset schema_config "type" values to ibis/duckdb type names.
_SCHEMA_TYPE_MAP = {
    "text": "string",
    "number": "float64",
    "boolean": "boolean",
    "select": "string",
}

# Ibis's default table alias in rendered SQL. display_sql post-processes this
# into a human-readable initials-based alias (e.g. "Customer Purchase" -> "cp").
_DEFAULT_IBIS_TABLE_ALIAS = "t0"


# ---------------------------------------------------------------------------
# Public: SQL rendering
# ---------------------------------------------------------------------------


def build_staging_sql(name: str, schema_config: dict[str, Any], transforms: Sequence[Transform]) -> str:
    """Compact DuckDB SQL used for query execution (no pretty printing)."""
    try:
        table = build_ibis_table(name, schema_config, transforms)
        return ibis.to_sql(table, dialect="duckdb", pretty=False)
    except Exception as e:
        return f"-- Error generating SQL: {e!s}"


def build_display_sql(name: str, schema_config: dict[str, Any], transforms: Sequence[Transform]) -> str:
    """Human-readable DuckDB SQL with dataset-derived alias + explicit columns."""
    try:
        table = build_ibis_table(name, schema_config, transforms, table_name=name)
        sql = ibis.to_sql(table, dialect="duckdb", pretty=True)
    except Exception as e:
        return f"-- Error generating SQL: {e!s}"

    alias = table_alias_from_name(name)
    sql = sql.replace(f'"{_DEFAULT_IBIS_TABLE_ALIAS}"', alias)
    # Remove quotes around bare column refs: ``sp."col"`` -> ``sp.col``.
    sql = re.sub(rf'{alias}\."(\w+)"', rf"{alias}.\1", sql)
    return _expand_select_star(sql, alias, schema_config)


def table_alias_from_name(name: str) -> str:
    """Lowercase initials of the dataset name (for human-readable SQL alias)."""
    return "".join(word[0].lower() for word in name.split() if word)


# ---------------------------------------------------------------------------
# Public: Ibis pipeline construction
# ---------------------------------------------------------------------------


def build_ibis_table(
    name: str,
    schema_config: dict[str, Any],
    transforms: Sequence[Transform],
    table_name: str | None = None,
) -> ibis.Table:
    """Build the Ibis table representing the MUTATE -> FILTER -> RENAME pipeline.

    ``table_name`` sets the FROM-clause identifier (used by display_sql);
    when omitted, the dataset's ``name`` is used.
    """
    table = _build_table_from_schema(name, schema_config, table_name)

    fields = schema_config.get("fields", {})
    if fields:
        table = table.select(*fields.keys())

    table = apply_cleaning_mutations(table, transforms)
    table = apply_filter_predicates(table, transforms)
    table = apply_alias_renames(table, transforms)
    return table


def apply_cleaning_mutations(table: ibis.Table, transforms: Sequence[Transform]) -> ibis.Table:
    """Stage 1: MUTATE — apply clean/map transforms as column expressions,
    in ``created_at`` order. Transforms without a ``created_at`` sort first (stable)."""
    cleaning_transforms = sorted(
        [t for t in transforms if t.is_enabled and t.transform_type in ("clean", "map") and t.expression_config],
        key=lambda t: getattr(t, "created_at", "") or "",
    )
    for t in cleaning_transforms:
        expr = CleaningExpression(t.expression_config)
        table = table.mutate(**{t.target_column: expr.as_ibis_expr(table, t.target_column)})
    return table


def apply_filter_predicates(table: ibis.Table, transforms: Sequence[Transform]) -> ibis.Table:
    """Stage 2: FILTER — apply filter transforms as WHERE clauses."""
    active_filters = [
        t.condition_json.as_ibis_filter(table)
        for t in transforms
        if t.is_enabled and t.transform_type == "filter" and t.condition_json
    ]
    if not active_filters:
        return table
    return table.filter(*active_filters)


def apply_alias_renames(table: ibis.Table, transforms: Sequence[Transform]) -> ibis.Table:
    """Stage 3: RENAME — apply alias transforms as column renames."""
    alias_renames: dict[str, str] = {}
    for t in transforms:
        if not (t.is_enabled and t.transform_type == "alias" and t.expression_config):
            continue
        expr = CleaningExpression(t.expression_config)
        if expr.alias_name:
            alias_renames[expr.alias_name] = t.target_column
    if not alias_renames:
        return table
    return table.rename(alias_renames)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _build_table_from_schema(name: str, schema_config: dict[str, Any], table_name: str | None) -> ibis.Table:
    """Build Ibis table expression from schema_config (no S3 read needed).

    Raises ``ValueError`` when the schema has no ``fields`` — callers wrap this
    in a ``"-- Error generating SQL: ..."`` comment at the public API level.
    """
    fields = schema_config.get("fields", {})
    if not fields:
        raise ValueError("No data or schema available for this dataset")

    ibis_schema = {column: _SCHEMA_TYPE_MAP.get(info.get("type", "text"), "string") for column, info in fields.items()}
    return ibis.table(ibis_schema, name=table_name or name)


def _expand_select_star(sql: str, alias: str, schema_config: dict[str, Any]) -> str:
    """Replace pretty-printed ``SELECT *`` with the explicit column list."""
    if "SELECT\n  *\n" not in sql:
        return sql
    fields = schema_config.get("fields", {})
    if not fields:
        return sql
    col_list = ",\n  ".join(f"{alias}.{col}" for col in fields)
    return sql.replace("SELECT\n  *\n", f"SELECT\n  {col_list}\n")
