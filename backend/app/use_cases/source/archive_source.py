"""Archive a source (move it to Cold Storage) or restore it.

Boolean-driven: ``archived=True`` stamps ``archived_at = now`` and
``retention_until = now + RETENTION_WINDOW``; ``archived=False`` restores the source
by clearing both fields. Both paths go through the generic
``MetadataRepository.update_source(**kwargs)``. Each direction is idempotency-preserving
— re-archiving an already-archived source keeps the original ``archived_at`` (the
retention clock is not advanced) and restoring an already-active source is a no-op,
both an improvement over ``archive_dataset``. Returns the refreshed source dict (the
source path returns dicts, not domain objects — mirrors ``get_source``).
"""

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.source.exceptions import SourceNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

# Hardcoded 90-day retention window (org-configurable retention is deferred, ADR-055 c).
RETENTION_WINDOW = timedelta(days=90)


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

    source = await metadata_repo.get_source(source_id)
    if source is None:
        raise SourceNotFound(source_id)

    if archived:
        if source.get("archived_at") is None:
            archived_at = datetime.now(UTC)
            return await metadata_repo.update_source(
                source_id,
                archived_at=archived_at,
                retention_until=archived_at + RETENTION_WINDOW,
            )
        return source

    if source.get("archived_at") is not None:
        return await metadata_repo.update_source(
            source_id,
            archived_at=None,
            retention_until=None,
        )

    return source
