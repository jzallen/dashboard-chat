"""Get source use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.source.exceptions import SourceNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def get_source(
    source_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Get a single source by ID.

    Raises:
        SourceNotFound: If the source does not exist.
    """
    source = await repositories.metadata.get_source(source_id)
    if source is None:
        raise SourceNotFound(source_id)
    return source
