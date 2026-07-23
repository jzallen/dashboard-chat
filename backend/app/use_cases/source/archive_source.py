"""Archive a source (move it to Cold Storage) or restore it.

Boolean-driven: ``archived=True`` moves the source to Cold Storage and
``archived=False`` restores it. The lifecycle transition — stamping/clearing
``archived_at`` + ``retention_until`` and the idempotency rules — belongs to the
``Source`` domain model (``Source.mark_archived``); this use case only fetches
the source, delegates the transition, and persists the result through the generic
``MetadataRepository.update_source(**kwargs)`` when the state actually changed.
Returns the refreshed source dict (the source path returns dicts, not domain
objects — mirrors ``get_source``).
"""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.source import Source
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.source.exceptions import SourceNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def archive_source(
    source_id: str,
    *,
    archived: bool,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Move a source to Cold Storage (``archived=True``) or restore it (``archived=False``).

    Raises:
        SourceNotFound: If the source does not exist.
        MetadataRepositoryError: If the database operation fails.
    """
    metadata_repo = repositories.metadata

    source_dict = await metadata_repo.get_source(source_id)
    if source_dict is None:
        raise SourceNotFound(source_id)

    source = Source(**source_dict)
    updated = source.mark_archived(archived)
    if updated is source:
        return source_dict

    return await metadata_repo.update_source(
        source_id,
        archived_at=updated.archived_at,
        retention_until=updated.retention_until,
    )
