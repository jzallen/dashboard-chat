"""Upload use cases for file upload and dataset creation flow.

This module implements the two-step upload flow:
1. Upload file → Creates UploadEvent with inferred schema
2. Create dataset → Processes upload into partitioned parquet files
"""

import io
from datetime import datetime
from typing import Any, TYPE_CHECKING
from uuid_utils import uuid7

import pandas as pd
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.exc import SQLAlchemyError

from ..exceptions import (
    DatasetNotFound,
    LakeRepositoryError,
    MetadataRepositoryError,
    ProjectNotFound,
)
from ..repositories import with_repositories
from ..utils.schema_inference import infer_schema_from_dataframe

if TYPE_CHECKING:
    from ..repositories import RepositoryContainer


class UploadNotFound(Exception):
    """Raised when an upload event is not found."""

    def __init__(self, upload_id: str):
        super().__init__(f"Upload with ID '{upload_id}' not found")


class UploadAlreadyProcessed(Exception):
    """Raised when trying to process an already processed upload."""

    def __init__(self, upload_id: str, status: str):
        super().__init__(f"Upload '{upload_id}' already has status '{status}'")


@with_repositories
async def upload_file(
    file_content: bytes,
    file_name: str,
    project_id: str,
    dataset_id: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> "UploadEvent":
    """Upload a file and create an UploadEvent.

    Step 1 of the upload flow: Store raw file for later processing.

    Args:
        file_content: Raw file bytes
        file_name: Original filename
        project_id: Project UUID (required)
        dataset_id: Optional dataset UUID (for re-uploads to existing dataset)
        repositories: Injected repository container

    Returns:
        UploadEvent domain model with preview_rows

    Raises:
        ProjectNotFound: If project doesn't exist
        DatasetNotFound: If dataset doesn't exist
        ValueError: If invalid file type or empty file
        MetadataRepositoryError: If database operation fails
        LakeRepositoryError: If storage operation fails
    """
    from sqlalchemy.exc import IntegrityError

    from ..models import UploadEvent

    metadata_repo = repositories["metadata_repository"]
    lake_repo = repositories["lake_repository"]

    if not file_name.lower().endswith(".csv"):
        raise ValueError("Only CSV files are supported")

    if not file_content:
        raise ValueError("File is empty")

    upload_id = str(uuid7())
    raw_storage_path = f"uploads/{project_id}/{upload_id}.csv"

    df = pd.read_csv(io.BytesIO(file_content))
    row_count = len(df)

    try:
        async with metadata_repo._session.begin_nested():
            record = await metadata_repo.create_upload_event(
                upload_id=upload_id,
                project_id=project_id,
                dataset_id=dataset_id,
                raw_storage_path=raw_storage_path,
                original_filename=file_name,
                file_size=len(file_content),
                row_count=row_count,
            )
    except IntegrityError:
        if not await metadata_repo.project_exists(project_id):
            raise ProjectNotFound(project_id)
        if dataset_id and not await metadata_repo.dataset_exists(dataset_id):
            raise DatasetNotFound(dataset_id)
        raise
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e

    try:
        lake_repo.write_raw_file(file_content, raw_storage_path)
    except (BotoCoreError, ClientError) as e:
        raise LakeRepositoryError(str(e)) from e

    preview_rows = df.head(10).to_dict(orient="records")

    return UploadEvent(
        id=record.id,
        project_id=record.project_id,
        dataset_id=record.dataset_id,
        status=record.status,
        raw_storage_path=record.raw_storage_path,
        original_filename=record.original_filename,
        file_size=record.file_size,
        row_count=record.row_count,
        error_message=record.error_message,
        created_at=record.created_at,
        processed_at=record.processed_at,
        preview_rows=preview_rows,
    )


@with_repositories
async def get_upload(
    upload_id: str,
    include_preview: bool = False,
    preview_limit: int = 10,
    *,
    repositories: "RepositoryContainer",
) -> dict[str, Any]:
    """Get an upload event by ID.

    Args:
        upload_id: Upload event UUID
        include_preview: Whether to include preview rows from raw file
        preview_limit: Number of preview rows to return
        repositories: Injected repository container

    Returns:
        UploadEvent dict with optional preview_rows

    Raises:
        UploadNotFound: If upload not found
        MetadataRepositoryError: If database operation fails
        LakeRepositoryError: If storage operation fails
    """
    metadata_repo = repositories["metadata_repository"]
    lake_repo = repositories["lake_repository"]

    try:
        upload_event = await metadata_repo.get_upload_event(upload_id)
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e

    if not upload_event:
        raise UploadNotFound(upload_id)

    if include_preview:
        try:
            raw_content = lake_repo.read_raw_file(upload_event["raw_storage_path"])
            df = pd.read_csv(io.BytesIO(raw_content))
            upload_event["preview_rows"] = df.head(preview_limit).to_dict(orient="records")
        except (BotoCoreError, ClientError) as e:
            raise LakeRepositoryError(str(e)) from e
    else:
        upload_event["preview_rows"] = []

    return upload_event


@with_repositories
async def list_uploads(
    project_id: str | None = None,
    dataset_id: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> list[dict[str, Any]]:
    """List upload events, optionally filtered by project or dataset.

    Args:
        project_id: Optional project UUID filter
        dataset_id: Optional dataset UUID filter
        repositories: Injected repository container

    Returns:
        List of UploadEvent dicts

    Raises:
        MetadataRepositoryError: If database operation fails
    """
    metadata_repo = repositories["metadata_repository"]

    try:
        return await metadata_repo.list_upload_events(
            project_id=project_id,
            dataset_id=dataset_id,
        )
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e


@with_repositories
async def create_dataset_from_upload(
    upload_id: str,
    project_id: str,
    name: str,
    partition_fields: list[str] | None = None,
    description: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> dict[str, Any]:
    """Create a dataset from an upload event.

    Step 2 of the upload flow: Process upload into partitioned parquet files.

    Args:
        upload_id: Upload event UUID
        project_id: Project UUID
        name: Dataset display name
        partition_fields: List of field names to partition by (optional)
        description: Optional dataset description
        repositories: Injected repository container

    Returns:
        Dataset dict with schema and preview

    Raises:
        UploadNotFound: If upload not found
        UploadAlreadyProcessed: If upload already processed
        ValueError: If project_id doesn't match upload
        MetadataRepositoryError: If database operation fails
        LakeRepositoryError: If storage operation fails
    """
    metadata_repo = repositories["metadata_repository"]
    lake_repo = repositories["lake_repository"]
    partition_fields = partition_fields or []

    # Get upload event
    try:
        upload_event = await metadata_repo.get_upload_event(upload_id)
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e

    if not upload_event:
        raise UploadNotFound(upload_id)

    # Validate upload is pending
    if upload_event["status"] != "pending":
        raise UploadAlreadyProcessed(upload_id, upload_event["status"])

    # Validate project_id matches
    if upload_event["project_id"] != project_id:
        raise ValueError(f"Project ID mismatch: upload belongs to {upload_event['project_id']}")

    # Mark upload as processing
    try:
        await metadata_repo.update_upload_event(upload_id, status="processing")
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e

    try:
        # Generate dataset ID
        dataset_id = str(uuid7())

        # Generate storage path prefix for partitioned data
        # Format: datasets/{project_id}/{dataset_id}/
        storage_path = f"datasets/{project_id}/{dataset_id}/"

        try:
            raw_content = lake_repo.read_raw_file(upload_event["raw_storage_path"])
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
                row_count=upload_event["row_count"],
                file_name=upload_event["original_filename"],
                file_size=upload_event["file_size"],
                description=description,
            )

            # Update partition_fields on the dataset
            await metadata_repo.update_dataset(dataset_id, partition_fields=partition_fields)

        except SQLAlchemyError as e:
            raise MetadataRepositoryError(str(e)) from e

        # Update upload event with dataset_id and completed status
        try:
            await metadata_repo.update_upload_event(
                upload_id,
                dataset_id=dataset_id,
                status="completed",
                processed_at=datetime.utcnow(),
            )
        except SQLAlchemyError as e:
            raise MetadataRepositoryError(str(e)) from e

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
            "row_count": upload_event["row_count"],
            "file_name": upload_event["original_filename"],
            "file_size": upload_event["file_size"],
            "preview_rows": preview_rows,
            "upload_id": upload_id,
        }

    except Exception as e:
        # Mark upload as failed on any error
        try:
            await metadata_repo.update_upload_event(
                upload_id,
                status="failed",
                error_message=str(e),
            )
        except SQLAlchemyError:
            pass
        raise
