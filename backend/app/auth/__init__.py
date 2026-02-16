import logging

from .types import AuthUser
from .context import clear_auth_user, get_auth_user, set_auth_user
from .provider import AuthProvider
from .exceptions import AuthenticationError, AuthorizationError

logger = logging.getLogger(__name__)


def get_auth_provider() -> AuthProvider:
    from app.config import get_settings
    settings = get_settings()
    if settings.auth_mode == "workos":
        from .workos_provider import WorkOSAuthProvider
        return WorkOSAuthProvider(settings)
    from .dev_provider import DevAuthProvider
    return DevAuthProvider()


async def enrich_org_id(user: AuthUser) -> AuthUser:
    """Look up the user's org_id from local DB when JWT doesn't include it.

    Returns the user unchanged if org_id is already set or lookup fails.
    """
    if user.org_id is not None:
        return user

    try:
        from sqlalchemy import select
        from app.database import async_session
        from app.repositories.metadata import ProjectRecord

        async with async_session() as session:
            result = await session.execute(
                select(ProjectRecord.org_id)
                .where(ProjectRecord.created_by == user.id)
                .where(ProjectRecord.org_id.isnot(None))
                .limit(1)
            )
            org_id = result.scalar_one_or_none()
            if org_id:
                return AuthUser(
                    id=user.id, email=user.email,
                    org_id=org_id, name=user.name,
                    org_name=user.org_name,
                )
    except Exception as e:
        logger.warning("Failed to enrich org_id for user %s: %s", user.id, e)

    return user


async def ensure_org_provisioned(user: AuthUser) -> None:
    """Auto-provision org + default project if missing from local DB.

    Gated on settings.auto_provision_org (default False). Designed for
    dev/SQLite environments where the DB may be reset between sessions.
    Non-fatal: swallows exceptions so login always succeeds.
    """
    from app.config import get_settings

    if not get_settings().auto_provision_org:
        return

    if not user.org_id:
        return

    try:
        from sqlalchemy import select
        from app.database import async_session
        from app.repositories.metadata import OrganizationRecord, ProjectRecord

        async with async_session() as session:
            result = await session.execute(
                select(OrganizationRecord.id)
                .where(OrganizationRecord.id == user.org_id)
                .limit(1)
            )
            if result.scalar_one_or_none() is not None:
                return  # org already exists

            org_name = user.org_name or "My Organization"
            org = OrganizationRecord(id=user.org_id, name=org_name)
            session.add(org)

            project = ProjectRecord(
                name="My First Project",
                org_id=user.org_id,
                created_by=user.id,
            )
            session.add(project)

            await session.commit()
            logger.info(
                "Auto-provisioned org %s (%s) with default project for user %s",
                user.org_id, org_name, user.id,
            )
    except Exception as e:
        logger.warning(
            "Failed to auto-provision org for user %s: %s", user.id, e
        )
