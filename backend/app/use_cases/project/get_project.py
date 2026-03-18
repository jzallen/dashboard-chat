"""Get project use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def get_project(
    project_id: str,
    user: AuthUser | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Get a single project by ID (metadata only).

    Args:
        project_id: The UUID of the project to retrieve.
        user: The authenticated user (injected by router).

    Returns:
        Success with project dict, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
    """
    metadata_repo = repositories.metadata
    project_dict = await metadata_repo.get_project(project_id)
    if project_dict is None:
        raise ProjectNotFound(project_id)
    return project_dict
