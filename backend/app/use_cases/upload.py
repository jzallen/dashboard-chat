"""Upload use cases for file upload flow.

This module implements step 1 of the two-step upload flow:
Upload file → Creates Upload with raw file storage

Uses the outbox pattern for event sourcing - state is reconstructed
from domain events stored in the outbox_messages table.
"""

import io
from typing import TYPE_CHECKING

import pandas as pd

from .exceptions import (
    DatasetNotFound,
    ProjectNotFound,
)
from app.models import Upload
from app.repositories import with_repositories

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer, OutboxRepository, LakeRepository, MetadataRepository



@with_repositories
async def upload_file(
    file_content: bytes,
    file_name: str,
    project_id: str,
    dataset_id: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Upload:
    """Upload a file and create an Upload.

    Step 1 of the upload flow: Store raw file for later processing.

    Args:
        file_content: Raw file bytes
        file_name: Original filename
        project_id: Project UUID (required)
        dataset_id: Optional dataset UUID (for re-uploads to existing dataset)
        repositories: Injected repository container

    Returns:
        Upload domain model with preview_rows

    Raises:
        ProjectNotFound: If project doesn't exist
        DatasetNotFound: If dataset doesn't exist
        ValueError: If invalid file type or empty file
        MetadataRepositoryError: If database operation fails
        LakeRepositoryError: If storage operation fails
    """
    metadata_repo: "MetadataRepository" = repositories["metadata_repository"]
    lake_repo: "LakeRepository" = repositories["lake_repository"]
    outbox_repo: "OutboxRepository" = repositories["outbox_repository"]

    if not file_name.lower().endswith(".csv"):
        raise ValueError("Only CSV files are supported")

    if not file_content:
        raise ValueError("File is empty")

    # Validate project exists
    if not await metadata_repo.project_exists(project_id):
        raise ProjectNotFound(project_id)

    # Validate dataset exists if provided
    if dataset_id and not await metadata_repo.dataset_exists(dataset_id):
            raise DatasetNotFound(dataset_id)

    df = pd.read_csv(io.BytesIO(file_content))

    outbox_record = await outbox_repo.submit_file_received_event(
        project_id=project_id,
        dataset_id=dataset_id,
        file_name=file_name,
        file_size=len(file_content),
    )

    lake_repo.write_raw_file(file_content, outbox_record.payload["raw_storage_path"])

    preview_rows = df.head(10).to_dict(orient="records")

    return Upload.from_outbox_record(outbox_record, preview_rows=preview_rows)