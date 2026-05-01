"""API routes for project memory and session management."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.types import AuthUser
from app.controllers import HTTPController

from .deps import authorize_project_access, get_current_user, use_db_context
from .schemas import SessionUpdate

router = APIRouter(prefix="/api/projects", tags=["sessions"])

# Top-level session router — endpoints rooted at /api/sessions/{session_id}.
# Auth is enforced inside the use case (org-scoped session lookup) rather than
# via a router-level dependency, since these routes are not project-nested.
session_replay_router = APIRouter(prefix="/api/sessions", tags=["session-replay"])


@router.get("/{project_id}/memory")
async def get_project_memory(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Get the memory (Stream channel) for a project."""
    user, project = auth
    body, status_code = await HTTPController.get_project_memory(project["id"], user=user)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{project_id}/sessions", status_code=201)
async def create_session(
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Create a new session (Stream thread) in a project."""
    user, project = auth
    body, status_code = await HTTPController.post_session(project["id"], user=user)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/sessions")
async def list_sessions(
    page_after: str | None = Query(default=None, alias="page[after]"),
    page_size: int = Query(default=30, ge=1, le=100, alias="page[size]"),
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """List sessions for a project with cursor-based pagination."""
    user, project = auth
    body, status_code = await HTTPController.list_sessions(
        project["id"],
        user=user,
        cursor=page_after,
        page_size=page_size,
    )
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{project_id}/sessions/{session_id}")
async def update_session(
    session_id: str,
    update_data: SessionUpdate,
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Update a session (owner-only)."""
    user, _project = auth
    session_kwargs = update_data.model_dump(exclude_unset=True)
    body, status_code = await HTTPController.patch_session(
        _project["id"],
        session_id,
        user=user,
        **session_kwargs,
    )
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{project_id}/datasets/search")
async def search_datasets(
    q: str = Query(..., min_length=1),
    auth: tuple[AuthUser, dict] = Depends(authorize_project_access),
):
    """Search datasets by name within a project."""
    user, project = auth
    body, status_code = await HTTPController.search_datasets(project["id"], q, user=user)
    return JSONResponse(content=body, status_code=status_code)


@session_replay_router.get("/{session_id}/events")
async def list_session_events(
    session_id: str,
    since: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: AuthUser = Depends(get_current_user),
    _db=Depends(use_db_context),
):
    """Session-event replay endpoint (dc-x3y.3.2 / Epic C).

    Returns persisted DomainEvents for the session since `since` (opaque
    cursor; omit for "from the beginning"). The response is a JSON page,
    not a server-sent stream — the chat side is the streaming surface; this
    endpoint is for headless replay consumers. Response shape per the bead:
        {session_id, events, next_cursor, has_more}

    Auth: org-scoped (404 for unknown session OR cross-org access — existence
    is not leaked). UI directives are filtered out per ADR-014.
    """
    body, status_code = await HTTPController.list_session_events(session_id, user=user, since=since, limit=limit)
    return JSONResponse(content=body, status_code=status_code)
