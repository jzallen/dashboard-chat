"""API routes for external SQL access management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.auth.types import AuthUser
from app.controllers import HTTPController

from .deps import authorize_project_access

router = APIRouter(prefix="/api/projects", tags=["sql-access"])


@router.post("/{project_id}/sql-access", status_code=201)
async def enable_sql_access(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Enable external SQL access for a project."""
    user, project = auth
    body, status_code = await HTTPController.enable_sql_access(project["id"], user=user, project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{project_id}/sql-access", status_code=204)
async def disable_sql_access(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Disable external SQL access for a project."""
    _user, project = auth
    body, status_code = await HTTPController.disable_sql_access(project["id"], project=project)
    if status_code == 204:
        return JSONResponse(content=None, status_code=204)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/sql-access")
async def get_sql_access(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Get SQL access connection details for a project."""
    _user, project = auth
    body, status_code = await HTTPController.get_sql_access(project["id"], project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sql-access/sync")
async def sync_sql_access(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Sync external SQL access views with current dataset state."""
    _user, project = auth
    body, status_code = await HTTPController.sync_sql_access(project["id"], project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sql-access/credentials")
async def regenerate_sql_credentials(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Regenerate SQL access credentials for a project."""
    _user, project = auth
    body, status_code = await HTTPController.regenerate_sql_credentials(project["id"], project=project)
    headers = {}
    if status_code == 429 and isinstance(body, dict) and "retry_after" in body:
        headers["Retry-After"] = str(body["retry_after"])
    return JSONResponse(content=body, status_code=status_code, headers=headers)


@router.post("/{project_id}/sql-access/environment/start")
async def start_environment(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Start a stopped SQL access environment."""
    _user, project = auth
    body, status_code = await HTTPController.start_environment(project["id"], project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sql-access/environment/stop")
async def stop_environment(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Stop a running SQL access environment."""
    _user, project = auth
    body, status_code = await HTTPController.stop_environment(project["id"], project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sql-access/environment/restart")
async def restart_environment(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Restart a SQL access environment."""
    _user, project = auth
    body, status_code = await HTTPController.restart_environment(project["id"], project=project)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/sql-access/environment/status")
async def get_environment_status(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Get detailed environment status."""
    _user, project = auth
    body, status_code = await HTTPController.get_environment_status(project["id"], project=project)
    return JSONResponse(content=body, status_code=status_code)
