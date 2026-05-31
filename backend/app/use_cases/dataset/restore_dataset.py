"""Restore a dataset (bring a source back from cold storage) — RED scaffold (created by DISTILL, MR-7).

DELIVER 07-01 replaces the scaffold body with the real implementation:
clears ``archived_at`` and ``retention_until`` (both ``None``) via the existing generic
``MetadataRepository.update_dataset(**kwargs)`` and returns the refreshed domain ``Dataset``.
"""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

__SCAFFOLD__ = True


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
    raise AssertionError("Not yet implemented — RED scaffold (restore_dataset, MR-7)")
