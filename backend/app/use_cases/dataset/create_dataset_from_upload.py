import asyncio
import io
import json
from typing import TYPE_CHECKING

import pandas as pd

from returns.result import Result

from app.use_cases import handle_returns
from app.use_cases.exceptions import (
    ProjectNotFound,
    UploadNotFound,
)
from app.repositories import with_repositories
from app.repositories.outbox import OutboxRepository
from app.models.dataset import Dataset
from app.utils.schema_inference import infer_schema_from_dataframe
from app.utils.column_profiler import compute_column_profiles

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

    file_received_event = await outbox_repo.get_file_received_event_by_id(upload_id)
    if file_received_event is None:
        raise UploadNotFound(upload_id)
    if not await metadata_repo.project_exists(file_received_event.project_id):
        raise ProjectNotFound(file_received_event.project_id)

    raw_content = await asyncio.to_thread(lake_repo.read_raw_file, file_received_event.raw_storage_path)

    if not raw_content:
        raise UploadNotFound(upload_id)

    df = await asyncio.to_thread(pd.read_csv, io.BytesIO(raw_content))
    df.columns = df.columns.str.strip()
    str_cols = df.select_dtypes(include="object").columns
    df[str_cols] = df[str_cols].apply(lambda col: col.str.strip())
    schema_config = infer_schema_from_dataframe(df)
    column_profiles = compute_column_profiles(df, schema_config)

    preview_rows = json.loads(df.head(10).to_json(orient='records', date_format='iso'))

    dataset_dict = await metadata_repo.create_dataset(
        project_id=file_received_event.project_id,
        name="New Dataset",
        schema_config=schema_config,
        description=description,
        partition_fields=partition_fields,
        column_profiles=column_profiles,
    )

    dataset = Dataset(
        id=dataset_dict["id"],
        project_id=dataset_dict["project_id"],
        name=dataset_dict["name"],
        description=dataset_dict["description"],
        schema_config=dataset_dict["schema_config"],
        partition_fields=dataset_dict["partition_fields"],
        preview_rows=preview_rows,
        column_profiles=dataset_dict["column_profiles"],
    )

    cleaned_csv = df.to_csv(index=False).encode("utf-8")
    await asyncio.to_thread(
        lambda: lake_repo.write_csv_as_partitioned_parquet(
            csv_content=cleaned_csv,
            storage_prefix=dataset.storage_path,
            partition_fields=partition_fields,
        )
    )

    await outbox_repo.mark_processed([upload_id])

    return dataset
