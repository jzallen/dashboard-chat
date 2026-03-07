import asyncio
import os
from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.plugins import PluginRegistry
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
) -> Result[Dataset, str]:
    """Create a dataset from an upload event.

    Step 2 of the upload flow: Process upload into partitioned parquet files.
    Uses plugin registry to determine how to parse the file.
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
            ext = os.path.splitext(file_received_event.original_filename)[1].lower()
            plugin = plugin_registry.get_for_extension(ext)

    if plugin:
        result = await asyncio.wait_for(
            asyncio.to_thread(plugin.process, raw_content, file_received_event.original_filename, choices),
            timeout=120,
        )
        df = result.df
        schema_hints = result.schema_hints
        format_context = result.chat_guidance
    else:
        # Fallback for backward compatibility (no registry provided)
        from app.utils.csv_parser import parse_and_clean_csv

        df = await asyncio.to_thread(parse_and_clean_csv, raw_content)
        schema_hints = None
        format_context = None

    schema_config, column_profiles, preview_rows = analyze_dataframe(df, schema_hints)

    dataset = await create_dataset_record(
        metadata_repo,
        file_received_event.project_id,
        schema_config,
        description,
        partition_fields,
        column_profiles,
        preview_rows,
        format_context=format_context,
    )

    await write_parquet(lake_repo, df, dataset, partition_fields)
    await outbox_repo.mark_processed([upload_id])

    return dataset
