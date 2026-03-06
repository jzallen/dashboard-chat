"""API routes for file uploads.

Upload flow (single step from client perspective):
POST /api/uploads - Upload file → internally creates dataset → returns Dataset
"""

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController

from .deps import use_db_context

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    project_id: str = Form(...),
    dataset_id: str | None = Form(None),
    _: AsyncSession = Depends(use_db_context),
):
    """Upload a file and create a dataset in one step.

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
    plugin_registry = request.app.state.plugin_registry

    # Step 1: Upload file
    upload_body, upload_status = await HTTPController.post_upload(
        content, file.filename, project_id, plugin_registry, dataset_id
    )
    if upload_status != 201:
        return JSONResponse(content=upload_body, status_code=upload_status)

    # If plugin needs user choices, return immediately with awaiting_input status
    upload_data = upload_body["data"]
    if upload_data.get("status") == "awaiting_input":
        return JSONResponse(content=upload_body, status_code=202)

    # Step 2: Redirect — create dataset from upload
    upload_id = upload_data["id"]
    dataset_body, dataset_status = await HTTPController.post_dataset(
        upload_id=upload_id, plugin_registry=plugin_registry
    )
    return JSONResponse(content=dataset_body, status_code=dataset_status)


@router.post("/{upload_id}/process")
async def process_upload(
    request: Request,
    upload_id: str,
    body: dict,
    _: AsyncSession = Depends(use_db_context),
):
    """Process an upload that is awaiting user input (e.g., sheet selection).

    Body: {"choices": {"sheet_name": "Sheet1"}}
    """
    plugin_registry = request.app.state.plugin_registry
    choices = body.get("choices", {})

    dataset_body, dataset_status = await HTTPController.post_dataset(
        upload_id=upload_id, plugin_registry=plugin_registry, choices=choices
    )
    return JSONResponse(content=dataset_body, status_code=dataset_status)


@router.get("/formats")
async def list_formats(request: Request):
    """Return registered file format plugins."""
    registry = request.app.state.plugin_registry
    formats = [
        {"name": p.name, "extensions": p.extensions, "label": p.label}
        for p in registry.all_plugins()
    ]
    return {"formats": formats}
