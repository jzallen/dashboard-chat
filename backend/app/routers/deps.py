"""Shared FastAPI dependencies for routers."""

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.auth.types import AuthUser
from app.config import get_settings
from app.database import get_db
from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectNotFound


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db


async def get_current_user(request: Request) -> AuthUser:
    """Read user identity from proxy headers, fall back to contextvar.

    When TRUST_PROXY_HEADERS is true and X-User-Id is present, constructs
    AuthUser from proxy headers (set by auth-proxy after token validation).
    Otherwise falls back to the contextvar set by AuthMiddleware.
    """
    settings = get_settings()
    if settings.trust_proxy_headers:
        user_id = request.headers.get("X-User-Id")
        if user_id:
            return AuthUser(
                id=user_id,
                org_id=request.headers.get("X-Org-Id"),
                email=request.headers.get("X-User-Email", ""),
            )
    # Fallback for direct access (tests, standalone mode)
    return get_auth_user()


async def authorize_project_access(
    project_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
) -> tuple[AuthUser, dict]:
    """Verify user's org owns the project. Returns (user, project_dict).

    Raises:
        ProjectNotFound: If project_id does not exist.
        AuthorizationError: If user's org_id does not match.
    """
    from app.repositories.metadata import MetadataRepository

    repo = MetadataRepository(db)
    project = await repo.get_project(project_id)
    if not project:
        raise ProjectNotFound(project_id)
    if project.get("org_id") and project["org_id"] != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")
    return user, project


async def authorize_dataset_access(
    dataset_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
) -> tuple[AuthUser, dict]:
    """Verify user's org owns the dataset's parent project.

    Raises:
        DatasetNotFound: If dataset_id does not exist.
        AuthorizationError: If user's org does not own parent project.
    """
    from app.repositories.metadata import MetadataRepository
    from app.use_cases.dataset.exceptions import DatasetNotFound

    repo = MetadataRepository(db)
    record = await repo.get_dataset_record(dataset_id, include_transforms=False)
    if not record:
        raise DatasetNotFound(dataset_id)
    project = record.project
    if project is not None:
        project_org_id = getattr(project, "org_id", None)
        if project_org_id and project_org_id != user.org_id:
            raise AuthorizationError(f"Access denied to dataset {dataset_id}")
    dataset_dict = {
        "id": record.id,
        "name": record.name,
        "project_id": record.project_id,
    }
    return user, dataset_dict
