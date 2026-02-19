from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.dataset import Dataset
    from app.models.transform import Transform


def generate_model_sql(
    project_name_snake: str, dataset_name_snake: str, dataset: Dataset
) -> str:
    """Generate CTE-based dbt SQL for a dataset's transforms.

    Builds a pipeline of CTEs: source -> cleaned -> filtered -> final
    based on which transform types are present and enabled.
    """
    enabled = [t for t in (dataset.transforms or []) if t.is_enabled]

    clean_transforms = sorted(
        [t for t in enabled if t.transform_type in ("clean", "map") and t.expression_config],
        key=lambda t: getattr(t, "created_at", "") or "",
    )
    filter_transforms = [
        t for t in enabled if t.transform_type == "filter" and t.condition_sql
    ]
    alias_transforms = [
        t for t in enabled if t.transform_type == "alias" and t.expression_config
    ]

    source_ref = f"{{{{ source('{project_name_snake}', '{dataset_name_snake}') }}}}"

    if not clean_transforms and not filter_transforms and not alias_transforms:
        return f"SELECT * FROM {source_ref}"

    schema_columns = _get_schema_columns(dataset)

    ctes: list[str] = []
    last_cte = "source"

    # source CTE is always present when we have transforms
    ctes.append(f"source AS (\n    SELECT * FROM {source_ref}\n)")

    # cleaned CTE
    if clean_transforms:
        cleaned_sql = _build_cleaned_cte(clean_transforms, schema_columns, last_cte)
        ctes.append(f"cleaned AS (\n{cleaned_sql}\n)")
        last_cte = "cleaned"

    # filtered CTE
    if filter_transforms:
        where_clauses = [t.condition_sql for t in filter_transforms]
        where_sql = "\n      AND ".join(where_clauses)
        ctes.append(
            f"filtered AS (\n"
            f"    SELECT *\n"
            f"    FROM {last_cte}\n"
            f"    WHERE {where_sql}\n"
            f")"
        )
        last_cte = "filtered"

    # final SELECT
    if alias_transforms:
        final_sql = _build_alias_select(alias_transforms, schema_columns, last_cte)
    else:
        final_sql = f"SELECT * FROM {last_cte}"

    cte_block = ",\n\n".join(ctes)
    return f"WITH {cte_block}\n\n{final_sql}"


def _get_schema_columns(dataset: Dataset) -> list[str] | None:
    """Extract ordered column names from schema_config, or None if unavailable."""
    fields = (dataset.schema_config or {}).get("fields", {})
    if fields:
        return list(fields.keys())
    return None


def _build_cleaned_cte(
    transforms: list[Transform],
    schema_columns: list[str] | None,
    source_cte: str,
) -> str:
    """Build the cleaned CTE body."""
    # Map column -> transform expression
    col_exprs: dict[str, str] = {}
    for t in transforms:
        expr = _transform_to_sql(t)
        if expr is not None:
            col_exprs[t.target_column] = expr

    if schema_columns:
        # List all columns explicitly
        select_parts = []
        for col in schema_columns:
            if col in col_exprs:
                select_parts.append(f"    {col_exprs[col]}")
            else:
                select_parts.append(f"    {col}")
        select_body = ",\n".join(select_parts)
    else:
        # No schema: list transform expressions then *
        parts = [f"    {expr}" for expr in col_exprs.values()]
        parts.append("    *")
        select_body = ",\n".join(parts)

    return f"    SELECT\n{select_body}\n    FROM {source_cte}"


def _build_alias_select(
    alias_transforms: list[Transform],
    schema_columns: list[str] | None,
    source_cte: str,
) -> str:
    """Build the final SELECT with alias renames."""
    # Map original column -> alias snake name
    aliases: dict[str, str] = {}
    for t in alias_transforms:
        config = t.expression_config or {}
        alias_name = config.get("alias") or config.get("alias_name", "")
        if alias_name:
            alias_snake = re.sub(r"[^a-z0-9]+", "_", alias_name.lower()).strip("_")
            aliases[t.target_column] = alias_snake

    if schema_columns:
        select_parts = []
        for col in schema_columns:
            if col in aliases:
                select_parts.append(f"    {col} AS {aliases[col]}")
            else:
                select_parts.append(f"    {col}")
        select_body = ",\n".join(select_parts)
    else:
        parts = [f"    {col} AS {alias}" for col, alias in aliases.items()]
        parts.append("    *")
        select_body = ",\n".join(parts)

    return f"SELECT\n{select_body}\nFROM {source_cte}"


def _transform_to_sql(t: Transform) -> str | None:
    """Convert a single clean/map transform to a SQL expression.

    Returns the expression string (e.g. 'TRIM(col) AS col') or None for unsupported.
    """
    config = t.expression_config or {}
    operation = config.get("operation", "")
    col = t.target_column

    if operation == "trim":
        return f"TRIM({col}) AS {col}"
    elif operation == "case":
        return _case_to_sql(config, col)
    elif operation == "fill_null":
        return _fill_null_to_sql(config, col)
    elif operation == "map_values":
        return _map_values_to_sql(config, col)
    else:
        return f"-- unsupported operation: {operation} for column {col}"


def _case_to_sql(config: dict, col: str) -> str:
    mode = config.get("mode", "")
    if mode == "upper":
        return f"UPPER({col}) AS {col}"
    elif mode == "lower":
        return f"LOWER({col}) AS {col}"
    elif mode == "title":
        return f"title_case({col}) AS {col}"
    elif mode == "snake":
        return f"snake_case({col}) AS {col}"
    elif mode == "kebab":
        return f"kebab_case({col}) AS {col}"
    else:
        return f"-- unsupported case mode: {mode} for column {col}"


def _is_numeric(value: str) -> bool:
    """Check if a string value represents a number."""
    try:
        float(value)
        return True
    except (ValueError, TypeError):
        return False


def _fill_null_to_sql(config: dict, col: str) -> str:
    fill_value = config.get("fill_value", "")
    if _is_numeric(str(fill_value)):
        return f"COALESCE({col}, {fill_value}) AS {col}"
    else:
        escaped = str(fill_value).replace("'", "''")
        return f"COALESCE({col}, '{escaped}') AS {col}"


def _map_values_to_sql(config: dict, col: str) -> str:
    mappings = config.get("mappings", [])
    if not mappings:
        return f"{col}"

    when_parts = []
    for m in mappings:
        from_val = m.get("from", "").replace("'", "''")
        to_val = m.get("to", "").replace("'", "''")
        when_parts.append(f"WHEN {col} = '{from_val}' THEN '{to_val}'")

    case_body = " ".join(when_parts)
    return f"CASE {case_body} ELSE {col} END AS {col}"
