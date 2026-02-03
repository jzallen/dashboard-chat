"""Upload use cases for file upload flow.

This module implements step 1 of the two-step upload flow:
Upload file → Creates UploadEvent with raw file storage

Uses the outbox pattern for event sourcing - state is reconstructed
from domain events stored in the outbox_messages table.
"""

import io
from typing import Any, TYPE_CHECKING
from uuid_utils import uuid7

import pandas as pd

from .exceptions import (
    DatasetNotFound,
    ProjectNotFound,
    UploadNotFound,
)
from ..models import UploadFileReceived
from ..repositories import with_repositories
from ..repositories.outbox_repository import OutboxRepository

if TYPE_CHECKING:
    from ..repositories import RepositoryContainer


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
    outbox_repo: OutboxRepository = repositories["outbox_repository"]

    if not file_name.lower().endswith(".csv"):
        raise ValueError("Only CSV files are supported")

    if not file_content:
        raise ValueError("File is empty")

    # Validate project exists
    if not await metadata_repo.project_exists(project_id):
        raise ProjectNotFound(project_id)

    # Validate dataset exists if provided
    if dataset_id:
        if not await metadata_repo.dataset_exists(dataset_id):
            raise DatasetNotFound(dataset_id)

    upload_id = str(uuid7())
    raw_storage_path = f"uploads/{project_id}/{upload_id}.csv"

    df = pd.read_csv(io.BytesIO(file_content))
    row_count = len(df)

    # Create the domain event
    event = UploadFileReceived(
        upload_id=upload_id,
        project_id=project_id,
        raw_storage_path=raw_storage_path,
        original_filename=file_name,
        file_size=len(file_content),
        row_count=row_count,
        dataset_id=dataset_id,
    )

    await outbox_repo.append_event(
        aggregate_type=OutboxRepository.AGGREGATE_TYPE_UPLOAD,
        aggregate_id=upload_id,
        event=event,
    )

    lake_repo.write_raw_file(file_content, raw_storage_path)

    preview_rows = df.head(10).to_dict(orient="records")

    return UploadEvent(
        id=upload_id,
        project_id=project_id,
        dataset_id=dataset_id,
        status="pending",
        raw_storage_path=raw_storage_path,
        original_filename=file_name,
        file_size=len(file_content),
        row_count=row_count,
        error_message=None,
        created_at=event.timestamp,
        processed_at=None,
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

    Reconstructs state from outbox events.

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
    lake_repo = repositories["lake_repository"]
    outbox_repo: OutboxRepository = repositories["outbox_repository"]

    upload_event = await outbox_repo.reconstruct_upload_state(upload_id)

    if not upload_event:
        raise UploadNotFound(upload_id)

    # Convert to dict for API response
    result = {
        "id": upload_event.id,
        "project_id": upload_event.project_id,
        "dataset_id": upload_event.dataset_id,
        "status": upload_event.status,
        "raw_storage_path": upload_event.raw_storage_path,
        "original_filename": upload_event.original_filename,
        "file_size": upload_event.file_size,
        "row_count": upload_event.row_count,
        "error_message": upload_event.error_message,
        "created_at": upload_event.created_at,
        "processed_at": upload_event.processed_at,
    }

    if include_preview:
        raw_content = lake_repo.read_raw_file(upload_event.raw_storage_path)
        df = pd.read_csv(io.BytesIO(raw_content))
        result["preview_rows"] = df.head(preview_limit).to_dict(orient="records")
    else:
        result["preview_rows"] = []

    return result


@with_repositories
async def list_uploads(
    project_id: str | None = None,
    dataset_id: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> list[dict[str, Any]]:
    """List upload events, optionally filtered by project or dataset.

    Reconstructs state for each upload from outbox events.

    Args:
        project_id: Optional project UUID filter
        dataset_id: Optional dataset UUID filter
        repositories: Injected repository container

    Returns:
        List of UploadEvent dicts

    Raises:
        MetadataRepositoryError: If database operation fails
    """
    outbox_repo: OutboxRepository = repositories["outbox_repository"]

    uploads = await outbox_repo.list_uploads(
        project_id=project_id,
        dataset_id=dataset_id,
    )

    # Convert to dicts for API response
    return [
        {
            "id": upload.id,
            "project_id": upload.project_id,
            "dataset_id": upload.dataset_id,
            "status": upload.status,
            "raw_storage_path": upload.raw_storage_path,
            "original_filename": upload.original_filename,
            "file_size": upload.file_size,
            "row_count": upload.row_count,
            "error_message": upload.error_message,
            "created_at": upload.created_at,
            "processed_at": upload.processed_at,
        }
        for upload in uploads
    ]
