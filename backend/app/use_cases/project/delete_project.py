"""Delete project use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def delete_project(
    project_id: str,
    user: AuthUser | None = None,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[bool, str]:
    """Delete a project and all its datasets.

    Args:
        project_id: The UUID of the project to delete.
        user: The authenticated user (injected by router).

    Returns:
        Success with True if deleted, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
    """
    metadata_repo = repositories.metadata
    deleted = await metadata_repo.delete_project(project_id)

    if not deleted:
        raise ProjectNotFound(project_id)

    return True
