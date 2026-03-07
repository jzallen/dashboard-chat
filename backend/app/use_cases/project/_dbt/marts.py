"""Generate mart model SQL for Report entities."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.report import Report


def generate_mart_sql(report_name_snake: str, report: Report, ref_name_map: dict[str, str]) -> str:
    """Generate mart model SQL for a Report.

    Args:
        report_name_snake: Snake-cased report name.
        report: Report domain object.
        ref_name_map: Maps source ref IDs to dbt model names
            (e.g., "stg_orders", "int_enriched", "fct_sales").

    Returns:
        SQL string with config block and ref() calls resolved.
    """
    config_line = f"{{{{ config(materialized='{report.materialization}') }}}}"

    sql = report.sql_definition
    for ref in report.source_refs:
        ref_id = ref["id"]
        if ref_id in ref_name_map:
            model_name = ref_name_map[ref_id]
            sql = sql.replace(ref_id, f"{{{{ ref('{model_name}') }}}}")

    return f"{config_line}\n\n{sql}"
