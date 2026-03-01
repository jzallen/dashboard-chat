"""API routes for project management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.controllers import HTTPController
from app.use_cases.exceptions import DomainException
from app.use_cases.project import export_dbt_project

from .deps import use_db_context
from .schemas import ProjectCreate, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects(_: AsyncSession = Depends(use_db_context)):
    """List all projects."""
    body, status_code = await HTTPController.list_projects()
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Get a single project by ID (metadata only)."""
    body, status_code = await HTTPController.get_project(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/datasets")
async def list_project_datasets(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """List sparse datasets for a project."""
    body, status_code = await HTTPController.list_project_datasets(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/export/dbt")
async def export_dbt_project_route(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Export a project as a dbt project zip archive.

    Returns a StreamingResponse with application/zip content.
    Bypasses HTTPController since binary responses can't use tuple[dict, int].
    """
    result = await export_dbt_project(project_id)
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
            elif isinstance(error, AuthorizationError):
                body = {
                    "type": "ACCESS_DENIED",
                    "title": "Access Denied",
                    "status": 403,
                    "detail": str(error),
                }
                return JSONResponse(content=body, status_code=403)
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
    _: AsyncSession = Depends(use_db_context),
):
    """Create a new project."""
    body, status_code = await HTTPController.post_project(
        name=project_data.name,
        description=project_data.description,
    )
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{project_id}")
async def update_project(
    project_id: str,
    update_data: ProjectUpdate,
    _: AsyncSession = Depends(use_db_context),
):
    """Update a project."""
    project_kwargs = update_data.model_dump(exclude_unset=True)
    body, status_code = await HTTPController.patch_project(project_id, **project_kwargs)
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Delete a project and all its datasets."""
    body, status_code = await HTTPController.delete_project(project_id)
    return JSONResponse(content=body, status_code=status_code)
