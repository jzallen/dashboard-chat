"""Transform use cases — batch create and batch update with outbox audit trail."""

from typing import Any, TYPE_CHECKING

from returns.result import Result

from app.use_cases import handle_returns
from app.use_cases.exceptions import DatasetNotFound
from app.repositories import with_repositories

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def create_transforms(
    dataset_id: str,
    transforms_input: list[dict[str, Any]],
    *,
    repositories: 'RepositoryContainer',
) -> Result[None, str]:
    """Batch-create transforms on a dataset.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
    """
    metadata_repo = repositories['metadata_repository']
    outbox_repo = repositories['outbox_repository']

    if not await metadata_repo.dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)

    created = await metadata_repo.create_transforms_batch(dataset_id, transforms_input)

    await outbox_repo.submit_transforms_created_event(
        dataset_id=dataset_id,
        transforms=created,
    )


@with_repositories
@handle_returns
async def update_transforms(
    dataset_id: str,
    updates: list[dict[str, Any]],
    *,
    repositories: 'RepositoryContainer',
) -> Result[None, str]:
    """Batch-update transforms (including soft-delete via status='deleted').

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
    """
    metadata_repo = repositories['metadata_repository']
    outbox_repo = repositories['outbox_repository']

    if not await metadata_repo.dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)

    await metadata_repo.update_transforms(updates)

    await outbox_repo.submit_transforms_updated_event(
        dataset_id=dataset_id,
        changes=updates,
    )
