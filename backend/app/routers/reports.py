"""API routes for report management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController

from .deps import use_db_context
from .schemas.report import ReportCreate, ReportUpdate

router = APIRouter(prefix="/api/projects/{project_id}/reports", tags=["reports"])


@router.get("")
async def list_reports(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """List all reports for a project."""
    body, status_code = await HTTPController.list_reports(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("", status_code=201)
async def create_report(
    project_id: str,
    data: ReportCreate,
    _: AsyncSession = Depends(use_db_context),
):
    """Create a new report."""
    body, status_code = await HTTPController.post_report(project_id, **data.model_dump())
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{report_id}")
async def get_report(
    project_id: str,
    report_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Get a single report by ID."""
    body, status_code = await HTTPController.get_report(report_id)
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{report_id}")
async def update_report(
    project_id: str,
    report_id: str,
    data: ReportUpdate,
    _: AsyncSession = Depends(use_db_context),
):
    """Update a report."""
    report_kwargs = data.model_dump(exclude_unset=True)
    body, status_code = await HTTPController.patch_report(report_id, **report_kwargs)
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{report_id}")
async def delete_report(
    project_id: str,
    report_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Delete a report."""
    body, status_code = await HTTPController.delete_report(report_id)
    return JSONResponse(content=body, status_code=status_code)
