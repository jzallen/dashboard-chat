"""Update project use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def update_project(
    project_id: str,
    update_data: dict[str, Any],
    user: AuthUser | None = None,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Update a project.

    Args:
        project_id: The UUID of the project to update.
        update_data: Fields to update (name, description).
        user: The authenticated user (injected by router).

    Returns:
        Success with updated project dict, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
    """
    metadata_repo = repositories.metadata
    updated = await metadata_repo.update_project(project_id, update_data, org_id=user.org_id if user else None)

    if updated is None:
        raise ProjectNotFound(project_id)

    return updated
