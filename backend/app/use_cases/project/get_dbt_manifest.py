"""Read the dbt export manifest (DBTProjectDetails) for a project.

A read-only sibling of :func:`export_dbt_project`. It reuses the same project
ownership / org scope and the same file-plan computation
(:func:`build_dbt_file_plan`) the zip uses, returning the file index + per-layer
counts + project name as a plain dict (JSON:API attributes) rather than zip bytes.
"""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.auth.types import AuthUser
from app.models.dataset import Dataset
from app.models.project import Project
from app.models.report import Report
from app.models.view import View
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project._dbt import build_dbt_file_plan
from app.use_cases.project._dbt.naming import to_snake_case
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def get_dbt_manifest(
    project_id: str,
    user: AuthUser | None = None,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict[str, Any], str]:
    """Return the DBTProjectDetails manifest for a project.

    Args:
        project_id: The UUID of the project.
        user: The authenticated user (injected by router).
        project: The pre-authorized project dict (injected by router), if any.

    Returns:
        Success with ``{project_name, layer_counts, files}``, or Failure.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
    """
    metadata_repo = repositories.metadata
    if project is None:
        project = await metadata_repo.get_project(project_id)
        if project is None:
            raise ProjectNotFound(project_id)

    records, _, _ = await metadata_repo.list_datasets(project_id, include_transforms=True)
    full_datasets = [Dataset.from_record(r, include_transforms=True) for r in records]

    view_records = await metadata_repo.list_views_by_project(project_id)
    views = [View.from_record(r) for r in view_records]

    report_records = await metadata_repo.list_reports_by_project(project_id)
    reports = [Report.from_record(r) for r in report_records]

    project_domain = Project(
        id=project["id"],
        name=project["name"],
        description=project.get("description"),
        datasets=full_datasets,
    )

    files = build_dbt_file_plan(project_domain, views=views, reports=reports)

    layer_counts: dict[str, int] = {}
    for entry in files:
        layer_counts[entry["layer"]] = layer_counts.get(entry["layer"], 0) + 1

    return {
        "id": project_domain.id,
        "project_name": to_snake_case(project_domain.name),
        "layer_counts": layer_counts,
        "files": list(files),
    }
