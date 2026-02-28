"""Upload use cases for file upload flow.

This module implements step 1 of the two-step upload flow:
Upload file -> Creates Upload with raw file storage

Uses the outbox pattern for event sourcing - state is reconstructed
from domain events stored in the outbox_messages table.
"""

import asyncio
import json
from typing import TYPE_CHECKING

from returns.result import Result

from app.models import Upload
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset.exceptions import DatasetNotFound
from app.use_cases.project.project_service import ProjectService
from app.use_cases.upload.exceptions import EmptyFile, InvalidFileType
from app.utils.csv_parser import parse_and_clean_csv

if TYPE_CHECKING:
    from app.repositories import MetadataRepository, RepositoryContainer


def _validate_upload(file_content: bytes, file_name: str) -> None:
    if not file_name.lower().endswith(".csv"):
        raise InvalidFileType()
    if not file_content:
        raise EmptyFile()


async def _validate_dataset_exists(
    metadata_repo: "MetadataRepository",
    dataset_id: str | None,
) -> None:
    if dataset_id and not await metadata_repo.dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)


@with_repositories
@handle_returns
async def upload_file(
    file_content: bytes,
    file_name: str,
    project_id: str,
    dataset_id: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[Upload, str]:
    """Upload a file and create an Upload.

    Step 1 of the upload flow: validate input, parse CSV, store raw file,
    and return an Upload with preview rows.
    """
    metadata_repo = repositories.metadata
    lake_repo = repositories.lake
    outbox_repo = repositories.outbox

    _validate_upload(file_content, file_name)

    project_service = ProjectService(repositories)
    await project_service.fetch_and_authorize_project(project_id)

    await _validate_dataset_exists(metadata_repo, dataset_id)

    df = await asyncio.to_thread(parse_and_clean_csv, file_content)

    outbox_record = await outbox_repo.submit_file_received_event(
        project_id=project_id,
        dataset_id=dataset_id,
        file_name=file_name,
        file_size=len(file_content),
    )

    await asyncio.to_thread(lake_repo.write_raw_file, file_content, outbox_record.payload["raw_storage_path"])

    preview_rows = json.loads(df.head(10).to_json(orient="records", date_format="iso"))

    return Upload.from_outbox_record(outbox_record, preview_rows=preview_rows)
