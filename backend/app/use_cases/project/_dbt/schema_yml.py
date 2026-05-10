from __future__ import annotations

from typing import TYPE_CHECKING, Any

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


def _build_constraint_tests(constraints: dict[str, Any] | None) -> list[Any]:
    """Translate a column's constraints dict into dbt schema tests.

    Emission order is deterministic:
        1. not_null      (from {"required": True})
        2. unique        (from {"unique": True})
        3. accepted_values  (from {"accepted_values": [...]} when non-empty)
        4. dbt_utils.expression_is_true >= min  (from {"range": {"min": N}})
        5. dbt_utils.expression_is_true <= max  (from {"range": {"max": N}})

    Falsy or missing values produce no test entry. If no constraint yields
    a test, returns an empty list — callers should NOT attach a `tests:`
    key in that case.
    """
    if not constraints:
        return []

    tests: list[Any] = []

    if constraints.get("required"):
        tests.append("not_null")

    if constraints.get("unique"):
        tests.append("unique")

    accepted = constraints.get("accepted_values")
    if accepted:
        tests.append({"accepted_values": {"values": list(accepted)}})

    range_spec = constraints.get("range") or {}
    if "min" in range_spec and range_spec["min"] is not None:
        tests.append({"dbt_utils.expression_is_true": {"expression": f">= {range_spec['min']}"}})
    if "max" in range_spec and range_spec["max"] is not None:
        tests.append({"dbt_utils.expression_is_true": {"expression": f"<= {range_spec['max']}"}})

    return tests


def schema_uses_dbt_utils(datasets: list[tuple[str, Dataset]]) -> bool:
    """Return True iff at least one dataset column would emit a dbt_utils test.

    Used by the zip orchestrator to decide whether to ship a packages.yml.
    Avoids regex-scanning the rendered YAML — instead reuses the same
    constraint translation logic as the schema generator.
    """
    for _snake_name, dataset in datasets:
        fields = dataset.schema_config.get("fields", {}) if dataset.schema_config else {}
        for col_info in fields.values():
            tests = _build_constraint_tests(col_info.get("constraints"))
            if any(isinstance(t, dict) and any(k.startswith("dbt_utils.") for k in t) for t in tests):
                return True
    return False


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


def _build_staging_column(col_name: str, col_info: dict) -> dict:
    """Build a schema.yml column entry from a dataset field, attaching
    constraint-driven dbt tests when present."""
    entry: dict = {
        "name": col_name,
        "data_type": _TYPE_MAP.get(col_info.get("type", "text"), "string"),
    }
    tests = _build_constraint_tests(col_info.get("constraints"))
    if tests:
        entry["tests"] = tests
    return entry


def generate_schema_yml(
    datasets: list[tuple[str, Dataset]],
    reports: list[tuple[str, Report]] | None = None,
) -> str:
    """Generate schema.yml with model definitions.

    Constraint translation: when a dataset field declares
    `constraints: {...}` in its schema_config, emit per-column dbt tests
    via :func:`_build_constraint_tests`. Columns with no constraints
    (or only falsy/empty values) ship without a `tests:` key, keeping
    constraint-free projects lean and avoiding a forced `dbt deps`.

    See ADR-019 Phase 2 and roadmap step 02-01 for the binding contract.
    """
    reports = reports or []

    models = []
    for snake_name, dataset in datasets:
        fields = dataset.schema_config.get("fields", {}) if dataset.schema_config else {}
        columns = [_build_staging_column(col_name, col_info) for col_name, col_info in fields.items()]
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
