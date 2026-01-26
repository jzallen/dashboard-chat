"""API routes for project management."""

from fastapi import APIRouter, Depends, HTTPException
from returns.result import Success, Failure
from sqlalchemy.ext.asyncio import AsyncSession

from ..controllers.project_controller import ProjectController
from ..controllers.response_wrapper import wrap_success, wrap_error
from ..database import get_db
from ..db_context import set_session
from ..schemas import ProjectCreate, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db


@router.get("")
async def list_projects(_: AsyncSession = Depends(use_db_context)):
    """List all projects."""
    result = await ProjectController.list_projects()

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            raise HTTPException(
                status_code=500,
                detail=wrap_error(error, "LIST_PROJECTS_ERROR")
            )


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Get a single project by ID with sparse dataset references."""
    result = await ProjectController.get_project(project_id)

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            status_code = 404 if error == "Project not found" else 500
            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "GET_PROJECT_ERROR")
            )


@router.post("", status_code=201)
async def create_project(
    project_data: ProjectCreate,
    _: AsyncSession = Depends(use_db_context),
):
    """Create a new project."""
    result = await ProjectController.create_project(project_data)

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            raise HTTPException(
                status_code=500,
                detail=wrap_error(error, "CREATE_PROJECT_ERROR")
            )


@router.patch("/{project_id}")
async def update_project(
    project_id: str,
    update_data: ProjectUpdate,
    _: AsyncSession = Depends(use_db_context),
):
    """Update a project."""
    result = await ProjectController.update_project(project_id, update_data)

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            status_code = 404 if error == "Project not found" else 500
            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "UPDATE_PROJECT_ERROR")
            )


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Delete a project and all its datasets."""
    result = await ProjectController.delete_project(project_id)

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            status_code = 404 if error == "Project not found" else 500
            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "DELETE_PROJECT_ERROR")
            )
