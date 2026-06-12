"""API routes for the Source aggregate (slice 1).

A Source is a logical table backed by one or more uploaded files sharing a
schema; its public SELECT * view is a Dataset linked via ``datasets.source_id``
(wired in a later slice). This slice exposes create + list + detail only.
"""

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.controllers import HTTPController

from .deps import authorize_project_access, get_current_user, use_db_context
from .schemas import ProcessUpload, RecordUpload, SourceCreate

router = APIRouter(prefix="/api/sources", tags=["sources"])


async def _authorize_source(source_id: str, user: AuthUser, db: AsyncSession) -> dict:
    """Resolve a source and authorize the caller via its parent project."""
    from app.repositories.metadata import MetadataRepository
    from app.use_cases.source.exceptions import SourceNotFound

    repo = MetadataRepository(db)
    source = await repo.get_source(source_id)
    if source is None:
        raise SourceNotFound(source_id)
    await authorize_project_access(project_id=source["project_id"], user=user, db=db)
    return source


@router.post("", status_code=201)
async def create_source(
    data: SourceCreate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """Create a Source within a project."""
    # Verify the user's org owns the project before creating the source.
    _, _project = await authorize_project_access(project_id=data.project_id, user=user, db=db)

    body, status_code = await HTTPController.post_source(
        project_id=data.project_id,
        name=data.name,
        schema_config=data.schema_config,
        user=user,
    )
    return JSONResponse(content=body, status_code=status_code)


@router.get("")
async def list_sources(
    project_id: str = Query(..., description="Parent project UUID"),
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """List the sources for a project (backs the lineage canvas)."""
    _, _project = await authorize_project_access(project_id=project_id, user=user, db=db)

    body, status_code = await HTTPController.list_sources(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{source_id}")
async def get_source(
    source_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """Get a single source by ID, authorized via its parent project."""
    await _authorize_source(source_id, user, db)

    body, status_code = await HTTPController.get_source(source_id)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{source_id}/uploads")
async def list_source_uploads(
    source_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """List the files uploaded to a source (backs the upload modal's Files list).

    Returns both ingested and still-pending uploads as a JSON:API ``uploads``
    list, authorized via the source's parent project.
    """
    await _authorize_source(source_id, user, db)

    body, status_code = await HTTPController.list_source_uploads(source_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{source_id}/uploads", status_code=202)
async def record_source_upload(
    source_id: str,
    data: RecordUpload,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """Record an upload against a source and mint a presigned PUT URL.

    Returns 202 with ``{upload_id, put_url, storage_key, status:"pending"}``;
    the browser then PUTs the file directly to ``put_url`` (MinIO) and calls
    the process endpoint. No bytes touch the app server here.
    """
    await _authorize_source(source_id, user, db)

    body, status_code = await HTTPController.record_source_upload(
        source_id=source_id,
        filename=data.filename,
        content_type=data.content_type,
        file_size=data.size,
        user=user,
    )
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{source_id}/uploads/{upload_id}/process")
async def process_source_upload(
    source_id: str,
    upload_id: str,
    request: Request,
    body: ProcessUpload | None = None,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """UI-triggered ingestion of a recorded upload.

    Reads the object back from MinIO, ingests it, and — for the first upload —
    creates + links the Source's Dataset. Returns 200 with the linked Dataset,
    202 ``awaiting_input`` with choices, or a 4xx domain error.
    """
    await _authorize_source(source_id, user, db)

    plugin_registry = request.app.state.plugin_registry
    choices = body.choices if body else None

    resp_body, status_code = await HTTPController.process_source_upload(
        source_id=source_id,
        upload_id=upload_id,
        plugin_registry=plugin_registry,
        choices=choices,
    )
    return JSONResponse(content=resp_body, status_code=status_code)
