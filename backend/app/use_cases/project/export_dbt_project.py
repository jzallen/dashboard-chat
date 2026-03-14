"""Export project as dbt project zip archive."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.models.dataset import Dataset
from app.models.project import Project
from app.models.report import Report
from app.models.view import View
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project._dbt import generate_dbt_project_zip
from app.use_cases.project._dbt.naming import to_snake_case
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.plugins import PluginRegistry
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def export_dbt_project(
    project_id: str,
    plugin_registry: "PluginRegistry | None" = None,
    user: AuthUser | None = None,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[tuple[bytes, str], str]:
    """Export a project as a dbt project zip archive.

    Args:
        project_id: The UUID of the project to export.
        user: The authenticated user (injected by router).

    Returns:
        Success with (zip_bytes, project_name_snake), or Failure with error.

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

    # Build Project domain object
    project = Project(
        id=project["id"],
        name=project["name"],
        description=project.get("description"),
        datasets=full_datasets,
    )

    project_name_snake = to_snake_case(project.name)
    zip_bytes = generate_dbt_project_zip(
        project, project_name_snake, views=views, reports=reports, plugin_registry=plugin_registry
    )

    return zip_bytes, project_name_snake
