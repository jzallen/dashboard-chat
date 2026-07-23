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
    archived: bool = False,
    repositories: "RepositoryContainer",
) -> Result[list[dict], str]:
    """List a project's sources (lineage canvas / Cold-Storage browser).

    ``archived=False`` returns the active catalog (excludes Cold Storage);
    ``archived=True`` returns only the archived sources.
    """
    return await repositories.metadata.list_sources(project_id, archived=archived)
