from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.plugins import PluginRegistry
from app.plugins.protocol import ProcessingResult
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound

from ._pipeline import (
    analyze_dataframe,
    create_dataset_record,
    fetch_upload_event,
    read_raw_file,
    write_parquet,
)
from ._pipeline.plugin_dispatch import UploadPluginDispatcher

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


async def _create_single_dataset(
    metadata_repo,
    lake_repo,
    project_id: str,
    result: ProcessingResult,
    description: str | None,
    partition_fields: list[str],
) -> Dataset:
    """Create one dataset from a single ProcessingResult."""
    schema_config, column_profiles, preview_rows, row_count = analyze_dataframe(result.df, result.schema_hints)
    dataset = await create_dataset_record(
        metadata_repo,
        project_id,
        schema_config,
        description,
        partition_fields,
        column_profiles,
        preview_rows,
        format_context=result.chat_guidance,
        name=result.name,
        row_count=row_count,
    )
    await write_parquet(lake_repo, result.df, dataset, partition_fields)
    return dataset


@handle_returns
@with_repositories
async def create_dataset_from_upload(
    upload_id: str,
    partition_fields: list[str] | None = None,
    description: str | None = None,
    plugin_registry: PluginRegistry | None = None,
    choices: dict[str, str] | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[Dataset | list[Dataset], str]:
    """Create dataset(s) from an upload event.

    The pipeline result always arrives canonicalized as a
    ``MultiProcessingResult``; a one-element wrapper is unwrapped back to
    a single ``Dataset`` before returning so the external shape stays
    ``Result[Dataset | list[Dataset], str]`` (ADR-022 DWD-5).
    """
    metadata_repo = repositories.metadata
    lake_repo = repositories.lake
    outbox_repo = repositories.outbox
    partition_fields = partition_fields or []

    file_received_event = await fetch_upload_event(outbox_repo, upload_id)
    if not await metadata_repo.project_exists(file_received_event.project_id):
        raise ProjectNotFound(file_received_event.project_id)

    raw_content = await read_raw_file(lake_repo, file_received_event.raw_storage_path, upload_id)

    dispatcher = UploadPluginDispatcher(plugin_registry, lake_repo, outbox_repo)
    multi_result = await dispatcher.dispatch(file_received_event, raw_content, upload_id, choices)
    results = multi_result.results

    datasets: list[Dataset] = []
    for item in results:
        dataset = await _create_single_dataset(
            metadata_repo,
            lake_repo,
            file_received_event.project_id,
            item,
            description,
            partition_fields,
        )
        datasets.append(dataset)

    # DWD-2 asymmetry guard: multi-dataset uploads write dataset_ids/dataset_id into the
    # outbox payload; single-dataset uploads leave the payload untouched. Phase 02 pins
    # this with an absence-assertion test; the explicit `len(results) > 1` guard is the
    # mechanical contract that test binds.
    if len(results) > 1:
        dataset_ids = [d.id for d in datasets]
        await outbox_repo.update_payload(
            upload_id,
            {
                "dataset_ids": dataset_ids,
                "dataset_id": dataset_ids[0],
            },
        )

    await outbox_repo.mark_processed([upload_id])

    await _emit_sync_events(
        repositories.external_access,
        outbox_repo,
        file_received_event.project_id,
        datasets,
    )

    return datasets if len(datasets) > 1 else datasets[0]


async def _emit_sync_events(external_access_repo, outbox_repo, project_id: str, datasets: list) -> None:
    """Emit DatasetSyncRequested events if the project has SQL access enabled."""
    engine_node_id = await external_access_repo.get_active_engine_node_id(project_id)
    if not engine_node_id:
        return
    for dataset in datasets:
        await outbox_repo.submit_dataset_sync_event(
            project_id=project_id,
            dataset_id=dataset.id,
            engine_node_id=engine_node_id,
        )
