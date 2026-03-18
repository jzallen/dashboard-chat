from __future__ import annotations

from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from app.models.dataset import Dataset
    from app.models.report import Report

_TYPE_MAP = {
    "text": "string",
    "number": "float64",
    "boolean": "boolean",
    "select": "string",
}

_REPORT_PREFIX_MAP = {
    "fact": "fct",
    "dimension": "dim",
}


def _build_report_column(col: dict) -> dict:
    """Build a schema.yml column entry from report column metadata."""
    entry: dict = {"name": col["name"]}
    meta: dict = {}
    if "semantic_role" in col:
        meta["semantic_role"] = col["semantic_role"]
    if "semantic_type" in col:
        meta["semantic_type"] = col["semantic_type"]
    if "time_granularity" in col:
        meta["time_granularity"] = col["time_granularity"]
    if "expr" in col:
        meta["expr"] = col["expr"]
    if "description" in col:
        meta["description"] = col["description"]
    if meta:
        entry["meta"] = meta
    return entry


def generate_schema_yml(
    datasets: list[tuple[str, Dataset]],
    reports: list[tuple[str, Report]] | None = None,
) -> str:
    """Generate schema.yml with model definitions."""
    reports = reports or []

    models = []
    for snake_name, dataset in datasets:
        fields = dataset.schema_config.get("fields", {}) if dataset.schema_config else {}
        columns = [
            {
                "name": col_name,
                "data_type": _TYPE_MAP.get(col_info.get("type", "text"), "string"),
            }
            for col_name, col_info in fields.items()
        ]
        models.append(
            {
                "name": f"stg_{snake_name}",
                "columns": columns,
            }
        )

    for snake_name, report in reports:
        prefix = _REPORT_PREFIX_MAP.get(report.report_type, "fct")
        columns = [_build_report_column(col) for col in report.columns_metadata] if report.columns_metadata else []
        models.append(
            {
                "name": f"{prefix}_{snake_name}",
                "columns": columns,
            }
        )

    config = {
        "version": 2,
        "models": models,
    }
    return yaml.dump(config, default_flow_style=False, sort_keys=False)
