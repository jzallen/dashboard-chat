"""Record-upload use case (slice 2).

Mints a presigned PUT URL so the browser can upload a file directly to MinIO,
and records the intent as a pending ``UploadRecorded`` outbox event. Writes NO
bytes — the bytes never touch the app server. A later UI-triggered process
request consumes the pending event, reads the object back, and ingests it.
"""

import uuid
from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.source.exceptions import SourceNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

# Presigned PUT URL validity window. 15 minutes is generous for a browser
# upload yet short enough to bound replay risk.
_PRESIGN_EXPIRES_IN_SECONDS = 900


@handle_returns
@with_repositories
async def record_upload(
    source_id: str,
    filename: str,
    content_type: str,
    file_size: int,
    user: AuthUser,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Record an upload against a Source and mint a presigned PUT URL.

    Args:
        source_id: The target Source UUID.
        filename: The original file name (used in the storage key).
        content_type: The Content-Type the browser will PUT (bound into the
            signature, so the browser must match it).
        file_size: The declared file size in bytes (recorded for later checks).
        user: The authenticated user (injected by router).

    Returns:
        Success with ``{upload_id, put_url, storage_key, status}`` (status
        ``"pending"``), or Failure on error.

    Raises:
        SourceNotFound: If the source does not exist.
    """
    metadata_repo = repositories.metadata
    lake_repo = repositories.lake
    outbox_repo = repositories.outbox

    source = await metadata_repo.get_source(source_id)
    if source is None:
        raise SourceNotFound(source_id)

    project_id = source["project_id"]
    upload_id = str(uuid.uuid4())
    storage_key = f"uploads/{project_id}/{source_id}/{upload_id}/{filename}"

    put_url = lake_repo.presigned_put_url(
        storage_key=storage_key,
        content_type=content_type,
        expires_in=_PRESIGN_EXPIRES_IN_SECONDS,
    )

    await outbox_repo.submit_upload_recorded_event(
        source_id=source_id,
        project_id=project_id,
        upload_id=upload_id,
        storage_key=storage_key,
        original_filename=filename,
        file_size=file_size,
        content_type=content_type,
        status="pending",
    )

    return {
        "upload_id": upload_id,
        "put_url": put_url,
        "storage_key": storage_key,
        "status": "pending",
    }
