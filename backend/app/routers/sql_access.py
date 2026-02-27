"""API routes for external SQL access management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController

from .deps import use_db_context

router = APIRouter(prefix="/api/projects", tags=["sql-access"])


@router.post("/{project_id}/sql-access", status_code=201)
async def enable_sql_access(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Enable external SQL access for a project.

    Provisions a pg_duckdb schema, creates a read-only role, and returns
    connection details including a one-time plaintext password.
    """
    body, status_code = await HTTPController.enable_sql_access(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{project_id}/sql-access", status_code=204)
async def disable_sql_access(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Disable external SQL access for a project.

    Drops the pg_duckdb schema and role, terminates connections.
    """
    body, status_code = await HTTPController.disable_sql_access(project_id)
    if status_code == 204:
        return JSONResponse(content=None, status_code=204)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/sql-access")
async def get_sql_access(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Get SQL access connection details for a project.

    Returns connection details (without password) if enabled,
    or a minimal response with enabled=false if not.
    """
    body, status_code = await HTTPController.get_sql_access(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sql-access/sync")
async def sync_sql_access(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Sync external SQL access views with current dataset state.

    Regenerates bootstrap SQL and re-creates views.
    """
    body, status_code = await HTTPController.sync_sql_access(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sql-access/credentials")
async def regenerate_sql_credentials(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Regenerate SQL access credentials for a project.

    Returns new one-time plaintext password. Rate-limited with Retry-After header.
    """
    body, status_code = await HTTPController.regenerate_sql_credentials(project_id)
    headers = {}
    if status_code == 429 and isinstance(body, dict) and "retry_after" in body:
        headers["Retry-After"] = str(body["retry_after"])
    return JSONResponse(content=body, status_code=status_code, headers=headers)


@router.post("/{project_id}/sql-access/environment/start")
async def start_environment(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Start a stopped SQL access environment."""
    body, status_code = await HTTPController.start_environment(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sql-access/environment/stop")
async def stop_environment(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Stop a running SQL access environment."""
    body, status_code = await HTTPController.stop_environment(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sql-access/environment/restart")
async def restart_environment(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Restart a SQL access environment."""
    body, status_code = await HTTPController.restart_environment(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/sql-access/environment/status")
async def get_environment_status(
    project_id: str,
    _: AsyncSession = Depends(use_db_context),
):
    """Get detailed environment status."""
    body, status_code = await HTTPController.get_environment_status(project_id)
    return JSONResponse(content=body, status_code=status_code)
