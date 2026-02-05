"""Create project use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def create_project(
    name: str,
    description: str | None = None,
    *,
    repositories: 'RepositoryContainer',
) -> Result[dict, str]:
    """Create a new project.

    Args:
        name: The project name.
        description: Optional description.

    Returns:
        Success with created project dict, or Failure with error message.
    """
    metadata_repo = repositories['metadata_repository']
    return await metadata_repo.create_project(name=name, description=description)
