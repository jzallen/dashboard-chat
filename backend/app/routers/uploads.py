"""API routes for file uploads.

Upload flow:
1. POST /api/uploads - Upload file, get UploadEvent with schema
2. POST /api/datasets - Create dataset from upload with partition config
"""

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController
from app.database import get_db
from app.repositories import set_session

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    dataset_id: str | None = Form(None),
    _: AsyncSession = Depends(use_db_context),
):
    """Upload a file and create an UploadEvent with inferred schema.

    Step 1 of the upload flow:
    1. Validates the file (CSV only, not empty)
    2. Stores raw file at uploads/{project_id}/{upload_id}.csv
    3. Infers schema from CSV for query builder
    4. Creates UploadEvent record with status='pending'
    5. Returns schema_config and preview_rows for partition field selection

    For new datasets: Only provide project_id
    For re-uploads: Provide both project_id and dataset_id
    """
    if not file.filename:
        return JSONResponse(status_code=400, content={
            "type": "INVALID_REQUEST", "title": "Invalid Request",
            "status": 400, "detail": "Filename is required",
        })

    content = await file.read()

    body, status_code = await HTTPController.post_upload(
        content, file.filename, project_id, dataset_id
    )
    return JSONResponse(content=body, status_code=status_code)
