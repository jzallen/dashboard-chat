"""Generate intermediate model SQL for View entities."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.use_cases.project._dbt.ibis_dbt_source import substitute_ref_ids_in_text

if TYPE_CHECKING:
    from app.models.view import View


def generate_intermediate_sql(view_name_snake: str, view: View, ref_name_map: dict[str, str]) -> str:
    """Generate intermediate model SQL for a View.

    Both branches emit dbt ``{{ ref(...) }}`` macros via the ibis-source
    plugin at ``app.use_cases.project._dbt.ibis_dbt_source`` (ADR-026 MR-2):

    * Structured-columns path — :class:`ViewIbisCompiler` delegates to
      :func:`render_view_with_dbt_refs`, which constructs a
      :class:`IbisDbtRefDuckDBCompiler` and renders macros DIRECTLY at
      source-table positions.
    * Legacy text path — when the view has no structured columns we fall
      back to :func:`substitute_ref_ids_in_text` over the raw
      ``view.sql_definition``. Production callers (``create_view`` /
      ``update_view``) still produce views without columns, so this path
      remains alive after MR-2; the substitution helper lives in the
      ibis_dbt_source module so this file performs no post-render string
      mutation of its own.

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
        sql = substitute_ref_ids_in_text(view.sql_definition, view, ref_name_map)

    return f"{config_line}\n\n{sql}"
