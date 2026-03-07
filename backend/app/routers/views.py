"""API routes for view management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController

from .deps import use_db_context
from .schemas.view import ViewCreate, ViewUpdate

router = APIRouter(prefix="/api/projects/{project_id}/views", tags=["views"])


@router.get("")
async def list_views(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """List all views for a project."""
    body, status_code = await HTTPController.list_views(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("", status_code=201)
async def create_view(
    project_id: str,
    data: ViewCreate,
    _: AsyncSession = Depends(use_db_context),
):
    """Create a new view."""
    body, status_code = await HTTPController.post_view(project_id, **data.model_dump())
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{view_id}")
async def get_view(
    project_id: str,
    view_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Get a single view by ID."""
    body, status_code = await HTTPController.get_view(view_id)
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{view_id}")
async def update_view(
    project_id: str,
    view_id: str,
    data: ViewUpdate,
    _: AsyncSession = Depends(use_db_context),
):
    """Update a view."""
    view_kwargs = data.model_dump(exclude_unset=True)
    body, status_code = await HTTPController.patch_view(view_id, **view_kwargs)
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{view_id}")
async def delete_view(
    project_id: str,
    view_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Delete a view."""
    body, status_code = await HTTPController.delete_view(view_id)
    return JSONResponse(content=body, status_code=status_code)
