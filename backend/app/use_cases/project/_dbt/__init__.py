"""dbt project generator — converts Dashboard Chat projects to dbt project zip archives."""

from __future__ import annotations

import zipfile
from collections.abc import Callable
from io import BytesIO
from typing import TYPE_CHECKING

from .bootstrap_sql import generate_bootstrap_sql
from .intermediate import generate_intermediate_sql
from .macros_sql import generate_macros_sql
from .manifest import build_dbt_file_plan as build_dbt_file_plan
from .manifest import report_model_prefix
from .marts import generate_mart_sql
from .model_sql import generate_model_sql
from .naming import deduplicate_names
from .naming import to_snake_case as to_snake_case
from .packages_yml import generate_packages_yml
from .profiles_yml import generate_profiles_yml
from .project_yml import generate_project_yml
from .readme import generate_readme
from .schema_yml import generate_schema_yml
from .sources_yml import generate_sources_yml

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.report import Report
    from app.models.view import View
    from app.plugins import PluginRegistry

__all__ = ["build_dbt_file_plan", "generate_dbt_project_zip", "to_snake_case"]

_BUCKET_PLACEHOLDER = "__S3_BUCKET__"


def _report_prefix(report_type: str) -> str:
    """Return the dbt model prefix for a report type."""
    return report_model_prefix(report_type)


def _collect_plugin_macros(plugin_registry: PluginRegistry | None) -> dict[str, dict[str, str]]:
    """Collect dbt macros from all registered plugins.

    Returns:
        Dict of plugin_name → {macro_name: sql_body}
    """
    if plugin_registry is None:
        return {}
    result = {}
    for plugin in plugin_registry.all_plugins():
        if plugin.dbt_macros:
            result[plugin.name] = plugin.dbt_macros
    return result


def _generate_plugin_macros_sql(plugin_name: str, macros: dict[str, str]) -> str:
    """Generate a dbt macro file for a plugin's macros."""
    parts = [f"{{% macro register_{plugin_name}_macros() %}}"]
    for macro_name, sql_body in macros.items():
        parts.append(f"""
  {{% set {macro_name}_sql %}}
{sql_body.strip()}
  {{% endset %}}

  {{% do run_query({macro_name}_sql) %}}""")
    parts.append("\n{% endmacro %}")
    return "\n".join(parts)


def generate_dbt_project_zip(
    project: Project,
    project_name_snake: str,
    views: list[View] | None = None,
    reports: list[Report] | None = None,
    plugin_registry: PluginRegistry | None = None,
) -> bytes:
    """Generate a complete dbt project as an in-memory zip archive.

    Args:
        project: Project domain object with datasets and transforms loaded.
        project_name_snake: Pre-computed snake_case project name.
        views: Optional list of View domain objects for intermediate models.
        reports: Optional list of Report domain objects for mart models.
        plugin_registry: Optional plugin registry for collecting plugin macros.

    Returns:
        Raw zip bytes ready for HTTP response.

    Raises:
        ExportValidationError: If a view or report references an entity not in the project.
    """
    from app.use_cases.project.exceptions import ExportValidationError

    datasets = project.datasets or []
    views = views or []
    reports = reports or []

    # Compute deduplicated snake_case names for datasets
    raw_names = [ds.name for ds in datasets]
    snake_names = deduplicate_names(raw_names)
    dataset_pairs = list(zip(snake_names, datasets, strict=False))

    # Build ref name map: entity ID -> dbt model name
    ref_name_map: dict[str, str] = {}
    for snake_name, ds in dataset_pairs:
        ref_name_map[ds.id] = f"stg_{snake_name}"

    # Deduplicate view names and register in ref map
    view_raw_names = [v.name for v in views]
    view_snake_names = deduplicate_names(view_raw_names)
    view_pairs = list(zip(view_snake_names, views, strict=False))

    for snake_name, view in view_pairs:
        ref_name_map[view.id] = f"int_{snake_name}"

    # Deduplicate report names and register in ref map
    report_raw_names = [r.name for r in reports]
    report_snake_names = deduplicate_names(report_raw_names)
    report_pairs = list(zip(report_snake_names, reports, strict=False))

    for snake_name, report in report_pairs:
        prefix = _report_prefix(report.report_type)
        ref_name_map[report.id] = f"{prefix}_{snake_name}"

    # Validate all view source refs resolve
    for _snake_name, view in view_pairs:
        for ref in view.source_refs:
            if ref["id"] not in ref_name_map:
                raise ExportValidationError(f"View '{view.name}' references deleted entity with ID '{ref['id']}'")

    # Validate all report source refs resolve
    for _snake_name, report in report_pairs:
        for ref in report.source_refs:
            if ref["id"] not in ref_name_map:
                raise ExportValidationError(f"Report '{report.name}' references deleted entity with ID '{ref['id']}'")

    # The file plan is the shared source of truth: the manifest endpoint and this
    # zip both derive their file set from build_dbt_file_plan, so the two cannot
    # drift. Here we map each planned path to its byte generator and write them.
    file_plan = build_dbt_file_plan(project, views=views, reports=reports)

    byte_providers: dict[str, Callable[[], str]] = {
        "dbt_project.yml": lambda: generate_project_yml(project_name_snake),
        "profiles.yml": lambda: generate_profiles_yml(project_name_snake),
        "models/staging/sources.yml": lambda: generate_sources_yml(project_name_snake, dataset_pairs),
        "models/schema.yml": lambda: generate_schema_yml(dataset_pairs, reports=report_pairs),
        # packages.yml is emitted only when a staging column needs a dbt_utils
        # macro; build_dbt_file_plan applies the same schema_uses_dbt_utils gate,
        # so it appears here exactly when the plan includes it. See ADR-019
        # Phase 2 / roadmap step 02-01.
        "packages.yml": generate_packages_yml,
        "macros/custom_functions.sql": generate_macros_sql,
        "scripts/bootstrap_db.sql": lambda: generate_bootstrap_sql(
            project_name_snake, dataset_pairs, _BUCKET_PLACEHOLDER
        ),
        "README.md": lambda: generate_readme(project.name),
    }
    for snake_name, ds in dataset_pairs:
        byte_providers[f"models/staging/stg_{snake_name}.sql"] = lambda sn=snake_name, dataset=ds: generate_model_sql(
            project_name_snake, sn, dataset
        )
    for snake_name, view in view_pairs:
        byte_providers[f"models/intermediate/int_{snake_name}.sql"] = lambda sn=snake_name, v=view: (
            generate_intermediate_sql(sn, v, ref_name_map)
        )
    for snake_name, report in report_pairs:
        prefix = _report_prefix(report.report_type)
        domain_snake = to_snake_case(report.domain)
        byte_providers[f"models/marts/{domain_snake}/{prefix}_{snake_name}.sql"] = lambda sn=snake_name, r=report: (
            generate_mart_sql(sn, r, ref_name_map)
        )

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for entry in file_plan:
            zf.writestr(entry["path"], byte_providers[entry["path"]]())

        # Plugin-contributed macros are a registry concern, not part of the
        # project file plan (the manifest endpoint has no plugin registry). They
        # are written in addition to the plan; only the plan is the manifest SSOT.
        plugin_macros = _collect_plugin_macros(plugin_registry)
        for p_name, macros in plugin_macros.items():
            macro_sql = _generate_plugin_macros_sql(p_name, macros)
            zf.writestr(f"macros/plugin_{p_name}.sql", macro_sql)

    return buf.getvalue()
