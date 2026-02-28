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

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.models import Upload
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset.exceptions import DatasetNotFound
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.upload.exceptions import EmptyFile, InvalidFileType
from app.utils.csv_parser import parse_and_clean_csv

if TYPE_CHECKING:
    from app.repositories import LakeRepository, MetadataRepository, OutboxRepository, RepositoryContainer


def _validate_upload(file_content: bytes, file_name: str) -> None:
    if not file_name.lower().endswith(".csv"):
        raise InvalidFileType()
    if not file_content:
        raise EmptyFile()


async def _validate_references(
    metadata_repo: "MetadataRepository",
    project_id: str,
    dataset_id: str | None,
) -> None:
    if not await metadata_repo.project_exists(project_id):
        raise ProjectNotFound(project_id)
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
    metadata_repo: MetadataRepository = repositories["metadata_repository"]
    lake_repo: LakeRepository = repositories["lake_repository"]
    outbox_repo: OutboxRepository = repositories["outbox_repository"]

    _validate_upload(file_content, file_name)
    await _validate_references(metadata_repo, project_id, dataset_id)

    project = await metadata_repo.get_project(project_id, include_datasets=False)
    user = get_auth_user()
    if project and project.get("org_id") and project["org_id"] != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

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
