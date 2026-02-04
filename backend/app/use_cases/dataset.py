"""Dataset use cases for dataset management.

Uses the outbox pattern for upload events - emits domain events
for state transitions during dataset creation.
"""

import io
from typing import Any, TYPE_CHECKING

import pandas as pd
from uuid_utils import uuid7

from .exceptions import (
    DatasetNotFound,
    ProjectIdRequired,
    ProjectNotFound,
    UploadNotFound,
)
from ..repositories import with_repositories
from ..repositories.dataset_record import DatasetRecord
from ..repositories.outbox import OutboxRepository
from ..models.dataset import Dataset
from ..models.transform import Transform
from ..types import QueryBuilderJSON
from ..utils.schema_inference import infer_schema_from_dataframe

if TYPE_CHECKING:
    from ..repositories import RepositoryContainer


@with_repositories
async def list_datasets(project_id: str | None = None, *, repositories: 'RepositoryContainer') -> list[Dataset]:
    """List all datasets for a project.

    Raises:
        ProjectIdRequired: If project_id is not provided.
    """

    if project_id is None:
        raise ProjectIdRequired()

    if not await repositories["metadata_repository"].project_exists(project_id=project_id):
        raise ProjectNotFound(project_id)

    result = await repositories["metadata_repository"].list_datasets(project_id=project_id)

    return [_to_domain_dataset(r, transform_records=r.transforms) for r in result]


@with_repositories
async def get_dataset(
    dataset_id: str,
    include_transforms: bool = True,
    include_preview: bool = False,
    preview_limit: int = 10,
    *,
    repositories: 'RepositoryContainer',
) -> Dataset:
    """Get a single dataset by ID with optional transforms and preview.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        MetadataRepositoryError: If database operation fails.
        LakeRepositoryError: If storage operation fails.
    """
    metadata_repo = repositories['metadata_repository']
    lake_repo = repositories['lake_repository']

    dataset_record = await metadata_repo.get_dataset_record(dataset_id, include_transforms)

    if not dataset_record:
        raise DatasetNotFound(dataset_id)

    preview_rows: list[dict] = []
    if include_preview:
        preview_rows = lake_repo.read_parquet_preview(dataset_record.storage_path, limit=preview_limit)

    transform_records = dataset_record.transforms if include_transforms else []
    return _to_domain_dataset(dataset_record, transform_records=transform_records, preview_rows=preview_rows)


@with_repositories
async def update_dataset(
    dataset_id: str,
    update_dict: dict[str, Any],
    *,
    repositories: 'RepositoryContainer',
) -> Dataset:
    """Update a dataset's metadata and transforms.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        MetadataRepositoryError: If database operation fails.
    """
    dataset = Dataset(id=dataset_id, transforms=update_dict.pop('transforms', None), **update_dict)

    if not await repositories['metadata_repository'].dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)

    await repositories['metadata_repository'].update_dataset(dataset_id, **update_dict)

    if dataset.transforms:
        await repositories['metadata_repository'].update_transforms(dataset.transforms)

    return await get_dataset(dataset_id, repositories=repositories)


@with_repositories
async def create_dataset_from_upload(
    upload_id: str,
    name: str,
    partition_fields: list[str] | None = None,
    description: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Dataset:
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
        Dataset

    Raises:
        UploadNotFound: If upload not found
        UploadAlreadyProcessed: If upload already processed
        MetadataRepositoryError: If database operation fails
        LakeRepositoryError: If storage operation fails
    """
    metadata_repo = repositories["metadata_repository"]
    lake_repo = repositories["lake_repository"]
    outbox_repo: OutboxRepository = repositories["outbox_repository"]
    partition_fields = partition_fields or []

    file_received_event = await outbox_repo.get_file_received_event_by_id(upload_id)
    if not metadata_repo.project_exists(file_received_event.project_id):
        raise ProjectNotFound(file_received_event.project_id)

    if not lake_repo.raw_file_exists(file_received_event.raw_storage_path):
        raise UploadNotFound(upload_id)


    raw_content = lake_repo.read_raw_file(file_received_event.raw_storage_path)

    df = pd.read_csv(io.BytesIO(raw_content))
    schema_config = infer_schema_from_dataframe(df)

    dataset = Dataset(
        id=uuid7(),
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

    return dataset


def _to_domain_dataset(
    dataset_record: DatasetRecord,
    transform_records: list | None = None,
    preview_rows: list[dict] | None = None,
) -> Dataset:
    """Convert ORM DatasetRecord to domain Dataset.

    Args:
        dataset_record: The ORM dataset record
        transform_records: List of transform records (None means don't include transforms)
        preview_rows: Preview data rows
    """

    return Dataset(
        id=dataset_record.id,
        project_id=dataset_record.project_id,
        name=dataset_record.name,
        description=dataset_record.description,
        schema_config=dataset_record.schema_config,
        partition_fields=dataset_record.partition_fields or [],
        transforms=transform_records,
        preview_rows=preview_rows or [],
    )
