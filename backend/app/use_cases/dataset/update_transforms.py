"""Update transforms use case — batch update transforms (including soft-delete)."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset.dataset_service import DatasetService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def update_transforms(
    dataset_id: str,
    updates: list[dict[str, Any]],
    *,
    repositories: "RepositoryContainer",
) -> Result[None, str]:
    """Batch-update transforms (including soft-delete via status='deleted').

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        AuthorizationError: If user's org does not own the parent project.
    """
    metadata_repo = repositories["metadata_repository"]
    outbox_repo = repositories["outbox_repository"]

    service = DatasetService(repositories)
    await service.fetch_and_authorize_dataset(dataset_id)

    await metadata_repo.update_transforms(updates)

    await outbox_repo.submit_transforms_updated_event(
        dataset_id=dataset_id,
        changes=updates,
    )
