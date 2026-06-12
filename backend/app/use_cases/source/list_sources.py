"""List sources use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def list_sources(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[list[dict], str]:
    """List all sources for a project (used by the lineage canvas)."""
    return await repositories.metadata.list_sources(project_id)
