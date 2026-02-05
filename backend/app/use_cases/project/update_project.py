"""Update project use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def update_project(
    project_id: str,
    update_data: dict[str, Any],
    *,
    repositories: 'RepositoryContainer',
) -> Result[dict, str]:
    """Update a project.

    Args:
        project_id: The UUID of the project to update.
        update_data: Fields to update (name, description).

    Returns:
        Success with updated project dict, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
    """
    metadata_repo = repositories['metadata_repository']
    project = await metadata_repo.update_project(project_id, update_data)

    if project is None:
        raise ProjectNotFound(project_id)

    return project
