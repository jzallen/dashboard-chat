"""Update transforms use case — batch update transforms (including soft-delete)."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset.dataset_service import DatasetService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
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
    metadata_repo = repositories.metadata
    outbox_repo = repositories.outbox

    service = DatasetService(repositories)
    dataset_record = await service.fetch_dataset_record(dataset_id)

    await metadata_repo.update_transforms(updates)

    await outbox_repo.submit_transforms_updated_event(
        dataset_id=dataset_id,
        changes=updates,
    )

    # Emit sync event if project has SQL access enabled
    project_id = dataset_record.project_id
    engine_node_id = await repositories.external_access.get_active_engine_node_id(project_id)
    if engine_node_id:
        await outbox_repo.submit_transform_sync_event(
            project_id=project_id,
            dataset_id=dataset_id,
            engine_node_id=engine_node_id,
        )
