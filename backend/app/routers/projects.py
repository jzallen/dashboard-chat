"""API routes for project management."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.controllers import HTTPController
from app.use_cases.exceptions import DomainException
from app.use_cases.project import export_dbt_project

from .deps import authorize_project_access, get_current_user, use_db_context
from .schemas import ProjectCreate, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects(
    page_after: str | None = Query(default=None, alias="page[after]"),
    page_size: int = Query(default=50, ge=1, le=100, alias="page[size]"),
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """List all projects with cursor-based pagination."""
    body, status_code = await HTTPController.list_projects(user=user, cursor=page_after, page_size=page_size)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}")
async def get_project(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Get a single project by ID (metadata only)."""
    user, project = auth
    body, status_code = await HTTPController.get_project(project["id"], user=user)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/datasets")
async def list_project_datasets(
    project_id: str,
    page_after: str | None = Query(default=None, alias="page[after]"),
    page_size: int = Query(default=50, ge=1, le=100, alias="page[size]"),
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """List sparse datasets for a project with cursor-based pagination."""
    _user, _ = auth
    body, status_code = await HTTPController.list_project_datasets(
        project_id, cursor=page_after, page_size=page_size
    )
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/export/dbt")
async def export_dbt_project_route(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Export a project as a dbt project zip archive."""
    user, project = auth
    result = await export_dbt_project(project["id"], user=user, project=project)
    match result:
        case Success(data):
            zip_bytes, project_name = data
            return StreamingResponse(
                iter([zip_bytes]),
                media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{project_name}_dbt.zip"'},
            )
        case Failure(error):
            if isinstance(error, DomainException):
                body = {
                    "type": error._type,
                    "title": error._title,
                    "status": error._status_code,
                    "detail": str(error),
                }
                return JSONResponse(content=body, status_code=error._status_code)
            else:
                body = {
                    "type": "INTERNAL_SERVER_ERROR",
                    "title": "Internal Server Error",
                    "status": 500,
                    "detail": "An unexpected error occurred.",
                }
                return JSONResponse(content=body, status_code=500)


@router.post("", status_code=201)
async def create_project(
    project_data: ProjectCreate,
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """Create a new project."""
    body, status_code = await HTTPController.post_project(
        name=project_data.name,
        description=project_data.description,
        user=user,
    )
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{project_id}")
async def update_project(
    update_data: ProjectUpdate,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Update a project."""
    user, project = auth
    project_kwargs = update_data.model_dump(exclude_unset=True)
    body, status_code = await HTTPController.patch_project(project["id"], user=user, project=project, **project_kwargs)
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{project_id}")
async def delete_project(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Delete a project and all its datasets."""
    user, project = auth
    body, status_code = await HTTPController.delete_project(project["id"], user=user, project=project)
    return JSONResponse(content=body, status_code=status_code)
