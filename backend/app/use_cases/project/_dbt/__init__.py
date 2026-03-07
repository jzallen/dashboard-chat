"""dbt project generator — converts Dashboard Chat projects to dbt project zip archives."""

from __future__ import annotations

import zipfile
from io import BytesIO
from typing import TYPE_CHECKING

from .bootstrap_sql import generate_bootstrap_sql
from .intermediate import generate_intermediate_sql
from .macros_sql import generate_macros_sql
from .marts import generate_mart_sql
from .model_sql import generate_model_sql
from .naming import deduplicate_names
from .naming import to_snake_case as to_snake_case
from .profiles_yml import generate_profiles_yml
from .project_yml import generate_project_yml
from .readme import generate_readme
from .schema_yml import generate_schema_yml
from .sources_yml import generate_sources_yml

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.report import Report
    from app.models.view import View

__all__ = ["generate_dbt_project_zip", "to_snake_case"]

_BUCKET_PLACEHOLDER = "__S3_BUCKET__"


def _report_prefix(report_type: str) -> str:
    """Return the dbt model prefix for a report type."""
    return "fct" if report_type == "fact" else "dim"


def generate_dbt_project_zip(
    project: Project,
    project_name_snake: str,
    views: list[View] | None = None,
    reports: list[Report] | None = None,
) -> bytes:
    """Generate a complete dbt project as an in-memory zip archive.

    Args:
        project: Project domain object with datasets and transforms loaded.
        project_name_snake: Pre-computed snake_case project name.
        views: Optional list of View domain objects for intermediate models.
        reports: Optional list of Report domain objects for mart models.

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
                raise ExportValidationError(
                    f"View '{view.name}' references deleted entity with ID '{ref['id']}'"
                )

    # Validate all report source refs resolve
    for _snake_name, report in report_pairs:
        for ref in report.source_refs:
            if ref["id"] not in ref_name_map:
                raise ExportValidationError(
                    f"Report '{report.name}' references deleted entity with ID '{ref['id']}'"
                )

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("dbt_project.yml", generate_project_yml(project_name_snake))
        zf.writestr("profiles.yml", generate_profiles_yml(project_name_snake))
        zf.writestr("models/staging/sources.yml", generate_sources_yml(project_name_snake, dataset_pairs))
        zf.writestr("models/schema.yml", generate_schema_yml(dataset_pairs, reports=report_pairs))
        zf.writestr("macros/custom_functions.sql", generate_macros_sql())
        zf.writestr(
            "scripts/bootstrap_db.sql",
            generate_bootstrap_sql(
                project_name_snake,
                dataset_pairs,
                _BUCKET_PLACEHOLDER,
            ),
        )
        zf.writestr("README.md", generate_readme(project.name))

        for snake_name, ds in dataset_pairs:
            sql = generate_model_sql(project_name_snake, snake_name, ds)
            zf.writestr(f"models/staging/stg_{snake_name}.sql", sql)

        for snake_name, view in view_pairs:
            sql = generate_intermediate_sql(snake_name, view, ref_name_map)
            zf.writestr(f"models/intermediate/int_{snake_name}.sql", sql)

        for snake_name, report in report_pairs:
            prefix = _report_prefix(report.report_type)
            domain_snake = to_snake_case(report.domain)
            sql = generate_mart_sql(snake_name, report, ref_name_map)
            zf.writestr(f"models/marts/{domain_snake}/{prefix}_{snake_name}.sql", sql)

    return buf.getvalue()
