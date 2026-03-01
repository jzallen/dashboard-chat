"""Export project as dbt project zip archive."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.models.project import Project
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project._dbt import generate_dbt_project_zip
from app.use_cases.project._dbt.naming import to_snake_case
from app.use_cases.project.project_service import ProjectService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def export_dbt_project(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[tuple[bytes, str], str]:
    """Export a project as a dbt project zip archive.

    Args:
        project_id: The UUID of the project to export.

    Returns:
        Success with (zip_bytes, project_name_snake), or Failure with error.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    svc = ProjectService(repositories)
    project_dict = await svc.fetch_and_authorize_project(project_id)

    records = await repositories.metadata.list_datasets(project_id, include_transforms=True)
    full_datasets = [Dataset.from_record(r, include_transforms=True) for r in records]

    # Build Project domain object
    project = Project(
        id=project_dict["id"],
        name=project_dict["name"],
        description=project_dict.get("description"),
        datasets=full_datasets,
    )

    project_name_snake = to_snake_case(project.name)
    zip_bytes = generate_dbt_project_zip(project, project_name_snake)

    return zip_bytes, project_name_snake
