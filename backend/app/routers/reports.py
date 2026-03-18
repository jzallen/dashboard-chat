"""API routes for report management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.types import AuthUser
from app.controllers import HTTPController

from .deps import authorize_project_access
from .schemas.report import ReportCreate, ReportUpdate

router = APIRouter(prefix="/api/projects/{project_id}/reports", tags=["reports"])


@router.get("")
async def list_reports(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """List all reports for a project."""
    _user, project = auth
    body, status_code = await HTTPController.list_reports(project["id"], project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.post("", status_code=201)
async def create_report(
    data: ReportCreate,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Create a new report."""
    _user, project = auth
    body, status_code = await HTTPController.post_report(project["id"], project=project, **data.model_dump())
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{report_id}")
async def get_report(
    report_id: str,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Get a single report by ID."""
    _user, project = auth
    body, status_code = await HTTPController.get_report(report_id, project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{report_id}")
async def update_report(
    report_id: str,
    data: ReportUpdate,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Update a report."""
    _user, project = auth
    report_kwargs = data.model_dump(exclude_unset=True)
    body, status_code = await HTTPController.patch_report(report_id, project=project, **report_kwargs)
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{report_id}")
async def delete_report(
    report_id: str,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Delete a report."""
    _user, project = auth
    body, status_code = await HTTPController.delete_report(report_id, project=project)
    return JSONResponse(content=body, status_code=status_code)
