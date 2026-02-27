"""Export project as dbt project zip archive."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.models.dataset import Dataset
from app.models.project import Project
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import ProjectNotFound
from app.use_cases.project.dbt import generate_dbt_project_zip
from app.use_cases.project.dbt.naming import to_snake_case

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
    metadata_repo = repositories["metadata_repository"]

    # Fetch project with sparse dataset references
    project_dict = await metadata_repo.get_project(project_id, include_datasets=True)
    if project_dict is None:
        raise ProjectNotFound(project_id)

    # Verify org_id
    user = get_auth_user()
    if project_dict.get("org_id") and project_dict["org_id"] != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    # Fetch full datasets with transforms
    sparse_datasets = project_dict.get("datasets", [])
    full_datasets = []
    for ds_info in sparse_datasets:
        record = await metadata_repo.get_dataset_record(ds_info["id"], include_transforms=True)
        if record:
            full_datasets.append(Dataset.from_record(record, include_transforms=True))

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
