"""Get project use case."""

from typing import TYPE_CHECKING

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
async def get_project(
    project_id: str,
    *,
    include_datasets: bool = True,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Get a single project by ID with optional dataset references.

    Args:
        project_id: The UUID of the project to retrieve.
        include_datasets: Whether to include sparse dataset references (default True).

    Returns:
        Success with project dict, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    metadata_repo = repositories["metadata_repository"]
    project = await metadata_repo.get_project(project_id, include_datasets=include_datasets)

    if project is None:
        raise ProjectNotFound(project_id)

    user = get_auth_user()
    if project.get("org_id") and project["org_id"] != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    return project
