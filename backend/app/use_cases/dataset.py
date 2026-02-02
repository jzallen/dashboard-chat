"""Dataset use cases for dataset management.

Uses the outbox pattern for upload events - emits domain events
for state transitions during dataset creation.
"""

import io
from datetime import datetime
from typing import Any, TYPE_CHECKING

import pandas as pd
from uuid_utils import uuid7

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.exc import SQLAlchemyError

from ..exceptions import (
    DatasetNotFound,
    LakeRepositoryError,
    MetadataRepositoryError,
    OutboxRepositoryError,
    ProjectIdRequired,
    ProjectNotFound,
    UploadAlreadyProcessed,
    UploadNotFound,
)
from ..models import UploadProcessingStarted, UploadCompleted, UploadFailed
from ..repositories import with_repositories
from ..repositories.dataset_record import DatasetRecord
from ..repositories.outbox_repository import OutboxRepository
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

    try:
        result = await repositories["metadata_repository"].list_datasets(project_id=project_id)
    except Exception as e:
        raise MetadataRepositoryError(str(e)) from e

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

    try:
        dataset_record = await metadata_repo.get_dataset_record(dataset_id, include_transforms)
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e

    if not dataset_record:
        raise DatasetNotFound(dataset_id)

    preview_rows: list[dict] = []
    if include_preview:
        try:
            preview_rows = lake_repo.read_parquet_preview(dataset_record.storage_path, limit=preview_limit)
        except (BotoCoreError, ClientError) as e:
            raise LakeRepositoryError(str(e)) from e

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

    try:
        if not await repositories['metadata_repository'].dataset_exists(dataset_id):
            raise DatasetNotFound(dataset_id)

        await repositories['metadata_repository'].update_dataset(dataset_id, **update_dict)

        if dataset.transforms:
            await repositories['metadata_repository'].update_transforms(dataset.transforms)
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e

    return await get_dataset(dataset_id, repositories=repositories)


@with_repositories
async def create_dataset_from_upload(
    upload_id: str,
    name: str,
    partition_fields: list[str] | None = None,
    description: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> dict[str, Any]:
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
        Dataset dict with schema and preview

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

    # Get upload event by reconstructing state from events
    try:
        upload_event = await outbox_repo.reconstruct_upload_state(upload_id)
    except SQLAlchemyError as e:
        raise OutboxRepositoryError(str(e)) from e

    if not upload_event:
        raise UploadNotFound(upload_id)

    # Validate upload is pending
    if upload_event.status != "pending":
        raise UploadAlreadyProcessed(upload_id, upload_event.status)

    project_id = upload_event.project_id

    # Emit processing started event
    try:
        await outbox_repo.append_event(
            aggregate_type=OutboxRepository.AGGREGATE_TYPE_UPLOAD,
            aggregate_id=upload_id,
            event=UploadProcessingStarted(upload_id=upload_id),
        )
    except SQLAlchemyError as e:
        raise OutboxRepositoryError(str(e)) from e

    try:
        # Generate dataset ID
        dataset_id = str(uuid7())

        # Compute storage path from domain model
        storage_path = Dataset.compute_storage_path(project_id, dataset_id)

        try:
            raw_content = lake_repo.read_raw_file(upload_event.raw_storage_path)
        except (BotoCoreError, ClientError) as e:
            raise LakeRepositoryError(str(e)) from e

        df = pd.read_csv(io.BytesIO(raw_content))
        schema_config = infer_schema_from_dataframe(df)

        try:
            lake_repo.write_csv_as_partitioned_parquet(
                csv_content=raw_content,
                storage_prefix=storage_path,
                partition_fields=partition_fields,
            )
        except (BotoCoreError, ClientError) as e:
            raise LakeRepositoryError(str(e)) from e

        try:
            await metadata_repo.create_dataset(
                project_id=project_id,
                dataset_id=dataset_id,
                storage_path=storage_path,
                name=name,
                schema_config=schema_config,
                description=description,
                partition_fields=partition_fields,
            )
        except SQLAlchemyError as e:
            raise MetadataRepositoryError(str(e)) from e

        # Emit completed event
        try:
            await outbox_repo.append_event(
                aggregate_type=OutboxRepository.AGGREGATE_TYPE_UPLOAD,
                aggregate_id=upload_id,
                event=UploadCompleted(upload_id=upload_id, dataset_id=dataset_id),
            )
        except SQLAlchemyError as e:
            raise OutboxRepositoryError(str(e)) from e

        # Read preview rows from partitioned parquet
        try:
            preview_rows = lake_repo.read_parquet_preview(storage_path, limit=10)
        except (BotoCoreError, ClientError) as e:
            preview_rows = []

        return {
            "id": dataset_id,
            "project_id": project_id,
            "storage_path": storage_path,
            "name": name,
            "description": description,
            "schema_config": schema_config,
            "partition_fields": partition_fields,
            "row_count": upload_event.row_count,
            "file_name": upload_event.original_filename,
            "file_size": upload_event.file_size,
            "preview_rows": preview_rows,
            "upload_id": upload_id,
        }

    except Exception as e:
        # Emit failed event on any error
        try:
            await outbox_repo.append_event(
                aggregate_type=OutboxRepository.AGGREGATE_TYPE_UPLOAD,
                aggregate_id=upload_id,
                event=UploadFailed(upload_id=upload_id, error_message=str(e)),
            )
        except SQLAlchemyError:
            pass
        raise


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
    transforms = []
    if transform_records is not None:
        transforms = [
            Transform(
                id=t.id,
                name=t.name,
                condition_json=QueryBuilderJSON.from_dict(t.condition_json),
                condition_sql=t.condition_sql,
                description=t.description,
                status=t.status,
            )
            for t in transform_records
        ]

    return Dataset(
        id=dataset_record.id,
        project_id=dataset_record.project_id,
        storage_path=dataset_record.storage_path,
        name=dataset_record.name,
        description=dataset_record.description,
        schema_config=dataset_record.schema_config,
        partition_fields=dataset_record.partition_fields or [],
        transforms=transforms,
        preview_rows=preview_rows or [],
    )
