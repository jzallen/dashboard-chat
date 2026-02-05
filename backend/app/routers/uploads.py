"""API routes for file uploads.

Upload flow:
1. POST /api/uploads - Upload file, get UploadEvent with schema
2. POST /api/datasets - Create dataset from upload with partition config
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from returns.result import Success, Failure
from sqlalchemy.ext.asyncio import AsyncSession

from ..controllers.dataset_controller import DatasetController
from ..controllers.response_wrapper import wrap_success, wrap_error
from ..database import get_db
from ..repositories import set_session

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
        raise HTTPException(
            status_code=400,
            detail=wrap_error("Filename is required", "INVALID_FILE")
        )

    content = await file.read()

    result = await DatasetController.upload_file(
        content, file.filename, project_id, dataset_id
    )

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            if "not found" in error.lower():
                status_code = 404
            elif error in ["Only CSV files are supported", "File is empty"]:
                status_code = 400
            else:
                status_code = 500

            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "UPLOAD_FILE_ERROR")
            )
