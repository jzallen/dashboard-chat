"""Delete project use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def delete_project(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> Result[bool, str]:
    """Delete a project and all its datasets.

    Args:
        project_id: The UUID of the project to delete.

    Returns:
        Success with True if deleted, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
    """
    metadata_repo = repositories['metadata_repository']
    deleted = await metadata_repo.delete_project(project_id)

    if not deleted:
        raise ProjectNotFound(project_id)

    return True
