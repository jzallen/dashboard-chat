"""Generate intermediate model SQL for View entities."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.view import View


def generate_intermediate_sql(view_name_snake: str, view: View, ref_name_map: dict[str, str]) -> str:
    """Generate intermediate model SQL for a View.

    If the view has structured columns, the SQL flows through
    :class:`ViewIbisCompiler` (ADR-026 MR-1). Otherwise we fall back to the
    legacy ``view.sql_definition`` text path with post-render ref-id
    substitution; ADR-026 MR-2 retires the legacy branch entirely by replacing
    the post-render replacement with an ibis-source plugin.

    Args:
        view_name_snake: Snake-cased view name.
        view: View domain object.
        ref_name_map: Maps source ref IDs to dbt model names
            (e.g., "stg_orders", "int_enriched").

    Returns:
        SQL string with config block and ref() calls resolved.
    """
    config_line = f"{{{{ config(materialized='{view.materialization}') }}}}"

    if view.columns:
        from app.use_cases.view.sql_generator import ViewIbisCompiler

        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)
    else:
        # MR-2 will replace this post-render regex with an ibis-source plugin
        # so dbt-ref macro emission becomes a first-class compiler output
        # rather than a string substitution after the fact.
        sql = view.sql_definition
        for ref in view.source_refs:
            ref_id = ref["id"]
            if ref_id in ref_name_map:
                model_name = ref_name_map[ref_id]
                sql = sql.replace(ref_id, f"{{{{ ref('{model_name}') }}}}")

    return f"{config_line}\n\n{sql}"
