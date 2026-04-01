"""Get project memory use case."""

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
async def get_project_memory(
    project_id: str,
    user: AuthUser,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Get the memory for a project.

    Args:
        project_id: The project ID.
        user: The authenticated user.

    Returns:
        Success with memory dict, or Failure with error message.
    """
    metadata_repo = repositories.metadata

    memory = await metadata_repo.get_project_memory(project_id)
    if not memory:
        raise ProjectNotFound(project_id)

    if memory["org_id"] != user.org_id:
        raise ProjectNotFound(project_id)

    return memory
