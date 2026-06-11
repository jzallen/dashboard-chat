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


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(use_db_context),
) -> AuthUser:
    """Read user identity from proxy headers, fall back to contextvar.

    When TRUST_PROXY_HEADERS is true and X-User-Id is present, constructs
    AuthUser from proxy headers (set by auth-proxy after token validation).
    Otherwise falls back to the contextvar set by AuthMiddleware.

    When DEV_NO_ORG is true, the org claim (X-Org-Id header or contextvar
    org_id) is IGNORED and the org is resolved from the database by
    ``organizations.created_by`` instead (D1). The ``db`` dependency is
    only touched on that path, so flag-off behaviour is unchanged.
    """
    settings = get_settings()
    user: AuthUser | None = None
    if settings.trust_proxy_headers:
        user_id = request.headers.get("X-User-Id")
        if user_id:
            user = AuthUser(
                id=user_id,
                # Normalise an empty X-Org-Id to None: the auth-proxy mints a
                # no-org WorkOS user's claim as "" (organization_id ?? ""), and an
                # empty string MEANS "no org". Without this, downstream `org_id is
                # not None` checks (e.g. create_organization's no-org guard) misread
                # "" as "already belongs to an org" and reject first-org creation.
                org_id=request.headers.get("X-Org-Id") or None,
                email=request.headers.get("X-User-Email", ""),
            )
    if user is None:
        # Fallback for direct access (tests, standalone mode)
        user = get_auth_user()
    if settings.dev_no_org:
        return await _resolve_org_by_created_by(user, db)
    return user


async def _resolve_org_by_created_by(user: AuthUser, db: AsyncSession) -> AuthUser:
    """DEV_NO_ORG (D1): replace the claimed org with the org the user created.

    Earliest ``created_at`` wins when the user created several orgs;
    org_id is None when the user created none (drives onboarding).
    """
    from dataclasses import replace

    from app.repositories.metadata import MetadataRepository

    org = await MetadataRepository(db).get_organization_by_created_by(user.id)
    return replace(user, org_id=org["id"] if org else None)


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
