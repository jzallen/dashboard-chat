"""API routes for project management."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.controllers import HTTPController, wrap_jsonapi_single
from app.controllers.assistant_audit_controller import AssistantAuditController
from app.controllers.project_controller import ProjectController
from app.use_cases.exceptions import DomainException
from app.use_cases.project import export_dbt_project, get_dbt_manifest

from .deps import authorize_project_access, get_current_user, use_db_context
from .schemas import AuditEntryCreate, AuditEntryToggle, ProjectCreate, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects(
    page_after: str | None = Query(default=None, alias="page[after]"),
    page_size: int = Query(default=50, ge=1, le=100, alias="page[size]"),
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """List all projects with cursor-based pagination."""
    body, status_code = await ProjectController.list_projects(user=user, cursor=page_after, page_size=page_size)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}")
async def get_project(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Get a single project by ID (metadata only)."""
    user, project = auth
    body, status_code = await ProjectController.get_project(project["id"], user=user)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/datasets")
async def list_project_datasets(
    project_id: str,
    page_after: str | None = Query(default=None, alias="page[after]"),
    page_size: int = Query(default=50, ge=1, le=100, alias="page[size]"),
    archived: bool = Query(default=False, description="Return only archived (cold-storage) datasets"),
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """List sparse datasets for a project with cursor-based pagination.

    By default archived (cold-storage) datasets are excluded; pass ``?archived=true`` to
    return ONLY the cold-storage list (MR-7).
    """
    _user, _ = auth
    body, status_code = await HTTPController.list_project_datasets(
        project_id, cursor=page_after, page_size=page_size, archived=archived
    )
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/audit")
async def list_audit_entries_route(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """List the project's assistant-audit entries (backs the UI ``getAudit``).

    A flat JSON:API list ordered by ``(node_id, sequence, created_at)``; the UI
    groups by ``node_id``. Each item carries ``tool``/``say``/``tag`` plus the
    joined ``transform_id``/``enabled`` (present iff the entry is transform-type).
    """
    user, project = auth
    body, status_code = await AssistantAuditController.list_audit_entries(project["id"], org_id=user.org_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/audit", status_code=201)
async def create_audit_entry_route(
    data: AuditEntryCreate,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Persist an assistant-audit entry (rich-catalog §2.7 Option A).

    The agent POSTs the full entry after executing a transform tool; the
    returned ``id`` is then threaded back as ``assistant_audit_entry_id`` on the
    transform create/patch so the ``Transform`` points UP at this entry (the
    reversed FK).
    """
    user, project = auth
    body, status_code = await AssistantAuditController.create_audit_entry(
        project["id"],
        node_id=data.node_id,
        node_kind=data.node_kind,
        payload=data.payload.model_dump(exclude_none=True),
        org_id=user.org_id,
    )
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{project_id}/audit/{audit_entry_id}")
async def toggle_audit_entry_route(
    audit_entry_id: str,
    data: AuditEntryToggle,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Toggle a transform-type assistant-audit entry (rich-catalog §2.5-2.6).

    Enables/disables the ``Transform`` pointing UP at the entry (the reversed FK),
    which recompiles the dataset's staging SQL on read. Returns the toggled entry
    (incl. ``node_id``) so the UI knows which node's audit to revalidate. 409 for
    log-only entries, 404 for missing/out-of-scope.
    """
    user, _project = auth
    body, status_code = await AssistantAuditController.toggle_audit_entry(
        audit_entry_id,
        enabled=data.enabled,
        org_id=user.org_id,
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


@router.get("/{project_id}/export/dbt/manifest")
async def get_dbt_manifest_route(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Return the dbt export manifest (DBTProjectDetails) for a project.

    The browsable file index that backs the dbt export modal. Shares its file plan
    with the zip download (``GET /api/projects/{id}/export/dbt``) so the manifest
    can never drift from the archive's contents.
    """
    user, project = auth
    result = await get_dbt_manifest(project["id"], user=user, project=project)
    match result:
        case Success(manifest):
            body = wrap_jsonapi_single(
                "dbt-manifests",
                manifest,
                f"/api/projects/{project['id']}/export/dbt/manifest",
            )
            return JSONResponse(content=body, status_code=200)
        case Failure(error):
            if isinstance(error, DomainException):
                body = {
                    "type": error._type,
                    "title": error._title,
                    "status": error._status_code,
                    "detail": str(error),
                }
                return JSONResponse(content=body, status_code=error._status_code)
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
    body, status_code = await ProjectController.post_project(
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
    body, status_code = await ProjectController.patch_project(
        project["id"], user=user, project=project, **project_kwargs
    )
    return JSONResponse(content=body, status_code=status_code)


@router.delete("/{project_id}")
async def delete_project(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Delete a project and all its datasets."""
    user, project = auth
    body, status_code = await ProjectController.delete_project(project["id"], user=user, project=project)
    return JSONResponse(content=body, status_code=status_code)
