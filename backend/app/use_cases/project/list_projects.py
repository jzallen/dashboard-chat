"""List projects use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def list_projects(
    *,
    repositories: 'RepositoryContainer',
) -> Result[list[dict], str]:
    """List all projects ordered by creation date (newest first)."""
    metadata_repo = repositories['metadata_repository']
    return await metadata_repo.list_projects()
