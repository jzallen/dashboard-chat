"""Archive a dataset (move a source to cold storage) — RED scaffold (created by DISTILL, MR-7).

DELIVER 07-01 replaces the scaffold body with the real implementation:
sets ``archived_at = now`` and ``retention_until = now + RETENTION_WINDOW`` via the
existing generic ``MetadataRepository.update_dataset(**kwargs)`` and returns the refreshed
domain ``Dataset``. The 90-day retention window is a hardcoded module constant
(org settings are display-only / not functional — DWD-M7-4).
"""

from datetime import timedelta
from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

__SCAFFOLD__ = True

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
    raise AssertionError("Not yet implemented — RED scaffold (archive_dataset, MR-7)")
