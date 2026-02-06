"""API routes for project management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController
from app.database import get_db
from app.repositories import set_session
from .schemas import ProjectCreate, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db


@router.get("")
async def list_projects(_: AsyncSession = Depends(use_db_context)):
    """List all projects."""
    body, status_code = await HTTPController.list_projects()
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    include_datasets: bool = True,
    _: AsyncSession = Depends(use_db_context),
):
    """Get a single project by ID with optional datasets."""
    body, status_code = await HTTPController.get_project(project_id, include_datasets)
    return JSONResponse(content=body, status_code=status_code)


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
