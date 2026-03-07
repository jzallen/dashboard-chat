"""Generate intermediate model SQL for View entities."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.view import View


def generate_intermediate_sql(
    view_name_snake: str, view: View, ref_name_map: dict[str, str]
) -> str:
    """Generate intermediate model SQL for a View.

    Args:
        view_name_snake: Snake-cased view name.
        view: View domain object.
        ref_name_map: Maps source ref IDs to dbt model names
            (e.g., "stg_orders", "int_enriched").

    Returns:
        SQL string with config block and ref() calls resolved.
    """
    config_line = f"{{{{ config(materialized='{view.materialization}') }}}}"

    sql = view.sql_definition
    for ref in view.source_refs:
        ref_id = ref["id"]
        if ref_id in ref_name_map:
            model_name = ref_name_map[ref_id]
            sql = sql.replace(ref_id, f"{{{{ ref('{model_name}') }}}}")

    return f"{config_line}\n\n{sql}"
