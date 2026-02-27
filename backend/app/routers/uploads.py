"""API routes for file uploads.

Upload flow (single step from client perspective):
POST /api/uploads - Upload file → internally creates dataset → returns Dataset
"""

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController

from .deps import use_db_context

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    dataset_id: str | None = Form(None),
    _: AsyncSession = Depends(use_db_context),
):
    """Upload a CSV file and create a dataset in one step.

    Internally chains upload → dataset creation:
    1. Validates and stores the raw file (POST /uploads logic)
    2. On success, redirects to dataset creation (POST /datasets logic)
    3. Returns the created Dataset with default name 'New Dataset'

    For new datasets: Only provide project_id
    For re-uploads: Provide both project_id and dataset_id
    """
    if not file.filename:
        return JSONResponse(
            status_code=400,
            content={
                "type": "INVALID_REQUEST",
                "title": "Invalid Request",
                "status": 400,
                "detail": "Filename is required",
            },
        )

    content = await file.read()

    # Step 1: Upload file
    upload_body, upload_status = await HTTPController.post_upload(content, file.filename, project_id, dataset_id)
    if upload_status != 201:
        return JSONResponse(content=upload_body, status_code=upload_status)

    # Step 2: Redirect — create dataset from upload
    upload_id = upload_body["data"]["id"]
    dataset_body, dataset_status = await HTTPController.post_dataset(upload_id=upload_id)
    return JSONResponse(content=dataset_body, status_code=dataset_status)
