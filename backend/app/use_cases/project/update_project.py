"""Update project use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
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
    metadata_repo = repositories["metadata_repository"]
    project = await metadata_repo.get_project(project_id, include_datasets=False)

    if project is None:
        raise ProjectNotFound(project_id)

    user = get_auth_user()
    if project.get("org_id") and project["org_id"] != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    updated = await metadata_repo.update_project(project_id, update_data)

    if updated is None:
        raise ProjectNotFound(project_id)

    return updated
