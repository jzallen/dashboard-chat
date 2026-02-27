"""dbt project generator — converts Dashboard Chat projects to dbt project zip archives."""

from __future__ import annotations

import zipfile
from io import BytesIO
from typing import TYPE_CHECKING

from .bootstrap_sql import generate_bootstrap_sql
from .macros_sql import generate_macros_sql
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


def generate_dbt_project_zip(project: Project, project_name_snake: str) -> bytes:
    """Generate a complete dbt project as an in-memory zip archive.

    Args:
        project: Project domain object with datasets and transforms loaded.
        project_name_snake: Pre-computed snake_case project name.

    Returns:
        Raw zip bytes ready for HTTP response.
    """
    datasets = project.datasets or []

    # Compute deduplicated snake_case names
    raw_names = [ds.name for ds in datasets]
    snake_names = deduplicate_names(raw_names)
    dataset_pairs = list(zip(snake_names, datasets, strict=False))

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("dbt_project.yml", generate_project_yml(project_name_snake))
        zf.writestr("profiles.yml", generate_profiles_yml(project_name_snake))
        zf.writestr("models/staging/sources.yml", generate_sources_yml(project_name_snake, dataset_pairs))
        zf.writestr("models/schema.yml", generate_schema_yml(dataset_pairs))
        zf.writestr("macros/custom_functions.sql", generate_macros_sql())
        zf.writestr(
            "scripts/bootstrap_db.sql",
            generate_bootstrap_sql(
                project_name_snake,
                dataset_pairs,
                "__S3_BUCKET__",
            ),
        )
        zf.writestr("README.md", generate_readme(project.name))

        for snake_name, ds in dataset_pairs:
            sql = generate_model_sql(project_name_snake, snake_name, ds)
            zf.writestr(f"models/staging/stg_{snake_name}.sql", sql)

    return buf.getvalue()
