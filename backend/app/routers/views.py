"""API routes for view management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.types import AuthUser
from app.controllers.view_controller import ViewController

from .deps import authorize_project_access
from .schemas.view import ViewCreate, ViewUpdate

router = APIRouter(prefix="/api/projects/{project_id}/views", tags=["views"])


@router.get("")
async def list_views(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """List all views for a project."""
    _user, project = auth
    body, status_code = await ViewController.list_views(project["id"], project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.post("", status_code=201)
async def create_view(
    data: ViewCreate,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Create a new view."""
    _user, project = auth
    body, status_code = await ViewController.post_view(project["id"], project=project, **data.model_dump())
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{view_id}")
async def get_view(
    view_id: str,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Get a single view by ID."""
    _user, project = auth
    body, status_code = await ViewController.get_view(view_id, project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{view_id}")
async def update_view(
    view_id: str,
    data: ViewUpdate,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Update a view."""
    _user, project = auth
    view_kwargs = data.model_dump(exclude_unset=True)
    body, status_code = await ViewController.patch_view(view_id, project=project, **view_kwargs)
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{view_id}")
async def delete_view(
    view_id: str,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Delete a view."""
    _user, project = auth
    body, status_code = await ViewController.delete_view(view_id, project=project)
    return JSONResponse(content=body, status_code=status_code)
