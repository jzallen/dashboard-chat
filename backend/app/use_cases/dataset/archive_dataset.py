"""Archive a dataset (move a source to cold storage) — MR-7.

Sets ``archived_at = now`` and ``retention_until = now + RETENTION_WINDOW`` via the
existing generic ``MetadataRepository.update_dataset(**kwargs)`` and returns the refreshed
domain ``Dataset``. The 90-day retention window is a hardcoded module constant
(org settings are display-only / not functional — DWD-M7-4).
"""

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset.dataset_service import DatasetService
from app.use_cases.dataset.exceptions import DatasetNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

# DWD-M7-4: hardcoded 90-day retention window (org-configurable retention is deferred (c)).
RETENTION_WINDOW = timedelta(days=90)


@handle_returns
@with_repositories
async def archive_dataset(
    dataset_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[Dataset, str]:
    """Move a dataset to cold storage.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        MetadataRepositoryError: If database operation fails.
    """
    metadata_repo = repositories.metadata

    if not await metadata_repo.dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)

    archived_at = datetime.now(UTC)
    await metadata_repo.update_dataset(
        dataset_id,
        archived_at=archived_at,
        retention_until=archived_at + RETENTION_WINDOW,
    )

    return await DatasetService(repositories).fetch_dataset(dataset_id)
