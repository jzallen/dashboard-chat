"""Get project use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def get_project(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Get a single project by ID (metadata only).

    Args:
        project_id: The UUID of the project to retrieve.

    Returns:
        Success with project dict, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    svc = ProjectService(repositories)
    return await svc.fetch_and_authorize_project(project_id)
