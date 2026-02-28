"""Delete project use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.project.project_service import ProjectService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def delete_project(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[bool, str]:
    """Delete a project and all its datasets.

    Args:
        project_id: The UUID of the project to delete.

    Returns:
        Success with True if deleted, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    svc = ProjectService(repositories)
    await svc.fetch_and_authorize_project(project_id)

    metadata_repo = repositories.metadata
    deleted = await metadata_repo.delete_project(project_id)

    if not deleted:
        raise ProjectNotFound(project_id)

    return True
