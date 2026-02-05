"""API routes for project management."""

# from fastapi import APIRouter, Depends, HTTPException
# from returns.result import Success, Failure
# from sqlalchemy.ext.asyncio import AsyncSession
#
# from ..controllers.response_wrapper import wrap_success, wrap_error
# from ..database import get_db
# from ..repositories import set_session
# from .schemas import ProjectCreate, ProjectUpdate
#
# router = APIRouter(prefix="/api/projects", tags=["projects"])
#
#
# async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
#     """Dependency that sets the db session in context for use cases."""
#     set_session(db)
#     return db
#
#
# @router.get("")
# async def list_projects(_: AsyncSession = Depends(use_db_context)):
#     """List all projects."""
#     pass
#
#
# @router.get("/{project_id}")
# async def get_project(
#     project_id: str,
#     _: AsyncSession = Depends(use_db_context),
# ):
#     """Get a single project by ID with sparse dataset references."""
#     pass
#
#
# @router.post("", status_code=201)
# async def create_project(
#     project_data: ProjectCreate,
#     _: AsyncSession = Depends(use_db_context),
# ):
#     """Create a new project."""
#     pass
#
#
# @router.patch("/{project_id}")
# async def update_project(
#     project_id: str,
#     update_data: ProjectUpdate,
#     _: AsyncSession = Depends(use_db_context),
# ):
#     """Update a project."""
#     pass
#
#
# @router.delete("/{project_id}")
# async def delete_project(
#     project_id: str,
#     _: AsyncSession = Depends(use_db_context),
# ):
#     """Delete a project and all its datasets."""
#     pass
