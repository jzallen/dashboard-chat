from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset._pipeline.ingestion import stg_model_name
from app.use_cases.dataset.dataset_service import DatasetService
from app.use_cases.dataset.exceptions import DatasetNotFound, ModelNameCollision
from app.use_cases.project._dbt.naming import resolved_view_name

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def update_dataset(
    dataset_id: str,
    update_dict: dict[str, Any],
    *,
    repositories: "RepositoryContainer",
) -> Result[Dataset, str]:
    """Update a dataset's metadata.

    The ``model_name`` (dbt machine name) field gets special handling: the input
    is forgiving-normalized to ``stg_<snake>``, checked for project-scoped
    uniqueness against sibling datasets' resolved view names, and — when the
    resolved name actually changes and SQL access is enabled — triggers a
    repoint sync that drops the old warehouse view and creates the new one.

    ``model_name`` is DECOUPLED from ``display_name``: editing one never derives
    or mutates the other.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        ModelNameCollision: If the normalized model_name duplicates a sibling's
            resolved warehouse view name in the same project.
        MetadataRepositoryError: If database operation fails.
    """
    metadata_repo = repositories.metadata

    existing_record = await metadata_repo.get_dataset_record(dataset_id, include_transforms=False)
    if existing_record is None:
        raise DatasetNotFound(dataset_id)

    previous_view_name: str | None = None
    if "model_name" in update_dict:
        existing = Dataset.from_record(existing_record, include_transforms=False)
        normalized = stg_model_name(update_dict["model_name"])
        await _reject_model_name_collision(dataset_id, existing.project_id, normalized, repositories)
        old_view_name = resolved_view_name(existing)
        update_dict["model_name"] = normalized
        if normalized != old_view_name:
            previous_view_name = old_view_name

    if update_dict:
        await metadata_repo.update_dataset(dataset_id, **update_dict)

    if previous_view_name is not None:
        await _emit_repoint_sync(dataset_id, existing.project_id, previous_view_name, repositories)

    return await DatasetService(repositories).fetch_dataset(dataset_id)


async def _reject_model_name_collision(
    dataset_id: str,
    project_id: str,
    normalized: str,
    repositories: "RepositoryContainer",
) -> None:
    """Raise ModelNameCollision if a SIBLING dataset already resolves to ``normalized``.

    The comparison is against each sibling's resolved view name (``model_name``
    when set, else the filename-derived fallback), so legacy null-model rows are
    included. The dataset being edited is excluded — re-applying its own name is
    idempotent, not a collision.
    """
    records, _, _ = await repositories.metadata.list_datasets(project_id, include_transforms=False)
    for record in records:
        if record.id == dataset_id:
            continue
        sibling = Dataset.from_record(record, include_transforms=False)
        if resolved_view_name(sibling) == normalized:
            raise ModelNameCollision(normalized)


async def _emit_repoint_sync(
    dataset_id: str,
    project_id: str,
    previous_view_name: str,
    repositories: "RepositoryContainer",
) -> None:
    """Emit a DatasetSyncRequested carrying the previous view name so the sync
    processor drops the stale warehouse view. No-op when SQL access is disabled.
    """
    engine_node_id = await repositories.external_access.get_active_engine_node_id(project_id)
    if not engine_node_id:
        return
    await repositories.outbox.submit_dataset_sync_event(
        project_id=project_id,
        dataset_id=dataset_id,
        engine_node_id=engine_node_id,
        previous_view_name=previous_view_name,
    )
