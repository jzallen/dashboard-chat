from .types import AuthUser
from .context import get_auth_user, set_auth_user
from .provider import AuthProvider
from .exceptions import AuthenticationError, AuthorizationError


def get_auth_provider() -> AuthProvider:
    from app.config import get_settings
    settings = get_settings()
    if settings.auth_mode == "workos":
        from .workos_provider import WorkOSAuthProvider
        return WorkOSAuthProvider(settings)
    from .dev_provider import DevAuthProvider
    return DevAuthProvider()
