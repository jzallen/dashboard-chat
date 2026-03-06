"""Upload use cases for file upload flow.

This module implements step 1 of the two-step upload flow:
Upload file -> Creates Upload with raw file storage

Uses the outbox pattern for event sourcing - state is reconstructed
from domain events stored in the outbox_messages table.
"""

import asyncio
import json
import os
from typing import TYPE_CHECKING

from returns.result import Result

from app.models import Upload
from app.plugins import PluginRegistry
from app.plugins.protocol import PluginValidationError
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset.exceptions import DatasetNotFound
from app.use_cases.project.project_service import ProjectService
from app.use_cases.upload.exceptions import EmptyFile, InvalidFileType, UnsupportedFormat

if TYPE_CHECKING:
    from app.repositories import MetadataRepository, RepositoryContainer


def _validate_upload(
    file_content: bytes, file_name: str, plugin_registry: PluginRegistry
) -> None:
    if not file_content:
        raise EmptyFile()

    ext = os.path.splitext(file_name)[1].lower()
    plugin = plugin_registry.get_for_extension(ext)
    if plugin is None:
        raise UnsupportedFormat(ext, plugin_registry.supported_extensions())


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
    plugin_registry: PluginRegistry,
    dataset_id: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[Upload, str]:
    """Upload a file and create an Upload.

    Step 1 of the upload flow: validate input, run plugin validation,
    store raw file, and return an Upload with preview rows.
    """
    metadata_repo = repositories.metadata
    lake_repo = repositories.lake
    outbox_repo = repositories.outbox

    _validate_upload(file_content, file_name, plugin_registry)

    project_service = ProjectService(repositories)
    await project_service.fetch_and_authorize_project(project_id)

    await _validate_dataset_exists(metadata_repo, dataset_id)

    ext = os.path.splitext(file_name)[1].lower()
    plugin = plugin_registry.get_for_extension(ext)

    # Validate with plugin
    await asyncio.to_thread(plugin.validate, file_content, file_name)

    # Check if plugin needs user choices
    choices = await asyncio.to_thread(plugin.detect_choices, file_content, file_name)

    # Process directly if no choices needed
    if choices is None:
        result = await asyncio.to_thread(plugin.process, file_content, file_name)
        preview_rows = json.loads(result.df.head(10).to_json(orient="records", date_format="iso"))
    else:
        preview_rows = []

    outbox_record = await outbox_repo.submit_file_received_event(
        project_id=project_id,
        dataset_id=dataset_id,
        file_name=file_name,
        file_size=len(file_content),
        plugin_name=plugin.name,
    )

    await asyncio.to_thread(lake_repo.write_raw_file, file_content, outbox_record.payload["raw_storage_path"])

    upload = Upload.from_outbox_record(outbox_record, preview_rows=preview_rows)

    if choices is not None:
        upload = Upload(
            id=upload.id,
            project_id=upload.project_id,
            dataset_id=upload.dataset_id,
            raw_storage_path=upload.raw_storage_path,
            original_filename=upload.original_filename,
            file_size=upload.file_size,
            status="awaiting_input",
            created_at=upload.created_at,
            preview_rows=[],
            choices=[c.__dict__ for c in choices],
        )

    return upload
