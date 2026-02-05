
import io
from typing import TYPE_CHECKING

import pandas as pd
from uuid_utils import uuid7

from returns.result import Result

from app.use_cases.dataset.dataset_service import handle_returns
from app.use_cases.exceptions import (
    ProjectNotFound,
    UploadNotFound,
)
from app.repositories import with_repositories
from app.repositories.outbox import OutboxRepository
from app.models.dataset import Dataset
from app.utils.schema_inference import infer_schema_from_dataframe

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def create_dataset_from_upload(
    upload_id: str,
    name: str,
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
        name: Dataset display name
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

    raw_content = lake_repo.read_raw_file(file_received_event.raw_storage_path)

    if not raw_content:
        raise UploadNotFound(upload_id)

    df = pd.read_csv(io.BytesIO(raw_content))
    schema_config = infer_schema_from_dataframe(df)

    dataset = Dataset(
        id=str(uuid7()),
        project_id=file_received_event.project_id,
        name=name,
        description=description,
        schema_config=schema_config,
        partition_fields=partition_fields,
        preview_rows=df.head(10).to_dict(orient='records')
    )

    await metadata_repo.create_dataset(
        project_id=dataset.project_id,
        dataset_id=dataset.id,
        storage_path=dataset.storage_path,
        name=dataset.name,
        schema_config=dataset.schema_config,
        description=dataset.description,
        partition_fields=dataset.partition_fields,
    )

    lake_repo.write_csv_as_partitioned_parquet(
        csv_content=raw_content,
        storage_prefix=dataset.storage_path,
        partition_fields=partition_fields,
    )

    await outbox_repo.mark_processed([upload_id])

    return dataset
