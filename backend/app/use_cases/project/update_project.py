"""Update project use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.project.project_service import ProjectService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def update_project(
    project_id: str,
    update_data: dict[str, Any],
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Update a project.

    Args:
        project_id: The UUID of the project to update.
        update_data: Fields to update (name, description).

    Returns:
        Success with updated project dict, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    svc = ProjectService(repositories)
    await svc.fetch_and_authorize_project(project_id)

    metadata_repo = repositories.metadata
    updated = await metadata_repo.update_project(project_id, update_data)

    if updated is None:
        raise ProjectNotFound(project_id)

    return updated
