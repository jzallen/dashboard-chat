import asyncio
from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.repositories.outbox import OutboxRepository
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound
from app.utils.csv_parser import parse_and_clean_csv

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
    *,
    repositories: "RepositoryContainer",
) -> Result[Dataset, str]:
    """Create a dataset from an upload event.

    Step 2 of the upload flow: Process upload into partitioned parquet files.
    Uses the outbox pattern for event sourcing.

    Args:
        upload_id: Upload event UUID
        partition_fields: List of field names to partition by (optional)
        description: Optional dataset description
        repositories: Injected repository container

    Returns:
        Result[Dataset, str]

    Raises:
        UploadNotFound: If upload not found
        ProjectNotFound: If project not found
        MetadataRepositoryError: If database operation fails
        LakeRepositoryError: If storage operation fails
    """
    metadata_repo = repositories["metadata_repository"]
    lake_repo = repositories["lake_repository"]
    outbox_repo: OutboxRepository = repositories["outbox_repository"]
    partition_fields = partition_fields or []

    file_received_event = await fetch_upload_event(outbox_repo, upload_id)
    if not await metadata_repo.project_exists(file_received_event.project_id):
        raise ProjectNotFound(file_received_event.project_id)

    raw_content = await read_raw_file(lake_repo, file_received_event.raw_storage_path, upload_id)
    df = await asyncio.to_thread(parse_and_clean_csv, raw_content)
    schema_config, column_profiles, preview_rows = analyze_dataframe(df)

    dataset = await create_dataset_record(
        metadata_repo,
        file_received_event.project_id,
        schema_config,
        description,
        partition_fields,
        column_profiles,
        preview_rows,
    )

    await write_parquet(lake_repo, df, dataset, partition_fields)
    await outbox_repo.mark_processed([upload_id])

    return dataset
