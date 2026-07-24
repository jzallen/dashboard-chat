"""API routes for file uploads.

Upload flow (single step from client perspective):
POST /api/uploads - Upload file → internally creates dataset → returns Dataset
"""

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.controllers.dataset_controller import DatasetController

from .deps import authorize_project_access, get_current_user, use_db_context

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    project_id: str = Form(...),
    dataset_id: str | None = Form(None),
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """Upload a file and create a dataset in one step."""
    # Verify user's org owns the project before processing upload
    _, project = await authorize_project_access(project_id=project_id, user=user, db=db)

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
    upload_body, upload_status = await DatasetController.post_upload(
        content, file.filename, project_id, plugin_registry, dataset_id, project=project
    )
    if upload_status != 201:
        return JSONResponse(content=upload_body, status_code=upload_status)

    # If plugin needs user choices, return immediately with awaiting_input status
    upload_data = upload_body["data"]
    if upload_data.get("status") == "awaiting_input":
        return JSONResponse(content=upload_body, status_code=202)

    # Step 2: Redirect — create dataset from upload
    upload_id = upload_data["id"]
    dataset_body, dataset_status = await DatasetController.post_dataset(
        upload_id=upload_id, plugin_registry=plugin_registry
    )
    return JSONResponse(content=dataset_body, status_code=dataset_status)


@router.post("/{upload_id}/process")
async def process_upload(
    request: Request,
    upload_id: str,
    body: dict,
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """Process an upload that is awaiting user input (e.g., sheet selection).

    Body: {"choices": {"sheet_name": "Sheet1"}}
    """
    choices = body.get("choices")
    if not choices or not isinstance(choices, dict):
        return JSONResponse(
            status_code=400,
            content={
                "type": "INVALID_REQUEST",
                "title": "Invalid Request",
                "status": 400,
                "detail": "Request body must include 'choices' as a non-empty object",
            },
        )

    plugin_registry = request.app.state.plugin_registry

    dataset_body, dataset_status = await DatasetController.post_dataset(
        upload_id=upload_id, plugin_registry=plugin_registry, choices=choices
    )
    return JSONResponse(content=dataset_body, status_code=dataset_status)


@router.get("/formats")
async def list_formats(request: Request):
    """Return registered file format plugins."""
    registry = request.app.state.plugin_registry
    formats = [{"name": p.name, "extensions": p.extensions, "label": p.label} for p in registry.all_plugins()]
    return {"formats": formats}
