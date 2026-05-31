"""Restore a dataset (bring a source back from cold storage) — MR-7.

Clears ``archived_at`` and ``retention_until`` (both ``None``) via the existing generic
``MetadataRepository.update_dataset(**kwargs)`` and returns the refreshed domain ``Dataset``.
"""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset.dataset_service import DatasetService
from app.use_cases.dataset.exceptions import DatasetNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def restore_dataset(
    dataset_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[Dataset, str]:
    """Bring a dataset back from cold storage.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        MetadataRepositoryError: If database operation fails.
    """
    metadata_repo = repositories.metadata

    if not await metadata_repo.dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)

    await metadata_repo.update_dataset(dataset_id, archived_at=None, retention_until=None)

    return await DatasetService(repositories).fetch_dataset(dataset_id)
