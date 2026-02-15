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
                )
    except Exception as e:
        logger.warning("Failed to enrich org_id for user %s: %s", user.id, e)

    return user
