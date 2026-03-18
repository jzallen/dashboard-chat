import asyncio
from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.plugins import PluginRegistry
from app.plugins.protocol import MultiProcessingResult, ProcessingResult
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
    schema_config, column_profiles, preview_rows = analyze_dataframe(
        result.df, result.schema_hints
    )
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
    )
    await write_parquet(lake_repo, result.df, dataset, partition_fields)
    return dataset


@with_repositories
@handle_returns
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

    Handles both single-dataset (ProcessingResult) and multi-dataset
    (MultiProcessingResult) plugin outputs.
    """
    metadata_repo = repositories.metadata
    lake_repo = repositories.lake
    outbox_repo = repositories.outbox
    partition_fields = partition_fields or []

    file_received_event = await fetch_upload_event(outbox_repo, upload_id)
    if not await metadata_repo.project_exists(file_received_event.project_id):
        raise ProjectNotFound(file_received_event.project_id)

    raw_content = await read_raw_file(lake_repo, file_received_event.raw_storage_path, upload_id)

    # Determine plugin from event or filename extension
    plugin = None
    if plugin_registry:
        plugin_name = getattr(file_received_event, "plugin_name", None)
        if plugin_name:
            plugin = plugin_registry.get_by_name(plugin_name)
        if plugin is None:
            plugin = plugin_registry.get_for_filename(file_received_event.original_filename)

    if plugin:
        result = await asyncio.wait_for(
            asyncio.to_thread(plugin.process, raw_content, file_received_event.original_filename, choices),
            timeout=120,
        )

        # Store converted artifact if the plugin produced one (e.g., HL7v2 → FHIR)
        converted_content = getattr(plugin, "_converted_content", None)
        if converted_content:
            converted_path = file_received_event.raw_storage_path.rsplit(".", 1)[0] + ".converted.fhir.json"
            await asyncio.to_thread(lake_repo.write_raw_file, converted_content, converted_path)
            await outbox_repo.update_payload(upload_id, {"converted_storage_path": converted_path})
    else:
        # Fallback for backward compatibility (no registry provided)
        from app.utils.csv_parser import parse_and_clean_csv

        df = await asyncio.to_thread(parse_and_clean_csv, raw_content)
        result = ProcessingResult(df=df)

    # Multi-dataset path
    if isinstance(result, MultiProcessingResult):
        datasets: list[Dataset] = []
        for item in result.results:
            dataset = await _create_single_dataset(
                metadata_repo, lake_repo,
                file_received_event.project_id,
                item, description, partition_fields,
            )
            datasets.append(dataset)

        # Link dataset IDs to the upload record
        dataset_ids = [d.id for d in datasets]
        await outbox_repo.update_payload(upload_id, {
            "dataset_ids": dataset_ids,
            "dataset_id": dataset_ids[0] if dataset_ids else None,
        })
        await outbox_repo.mark_processed([upload_id])
        return datasets

    # Single-dataset path (unchanged behavior)
    dataset = await _create_single_dataset(
        metadata_repo, lake_repo,
        file_received_event.project_id,
        result, description, partition_fields,
    )
    await outbox_repo.mark_processed([upload_id])
    return dataset
