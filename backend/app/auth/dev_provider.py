from .types import AuthUser
from .exceptions import AuthenticationError

DEV_USER = AuthUser(id="dev-user-001", email="dev@localhost", org_id="dev-org-001", name="Dev User")
DEV_TOKEN = "dev-token-static"
DEV_REFRESH_PREFIX = "dev-refresh-token-"


class DevAuthProvider:
    """Auth provider for local development -- no network calls needed."""

    async def verify_token(self, token: str) -> AuthUser:
        if token == DEV_TOKEN:
            return DEV_USER
        raise AuthenticationError("Invalid dev token")

    async def get_login_url(self, redirect_uri: str, *, organization_id: str | None = None) -> tuple[str, str]:
        return f"{redirect_uri}?code=dev-auth-code", "dev-state-static"

    async def handle_callback(self, code: str) -> tuple[AuthUser, str, str, int]:
        return DEV_USER, DEV_TOKEN, "dev-refresh-token-001", 300

    async def refresh_access_token(self, refresh_token: str) -> tuple[AuthUser, str, str, int]:
        if not refresh_token.startswith(DEV_REFRESH_PREFIX):
            raise AuthenticationError("Invalid refresh token")
        suffix = refresh_token[len(DEV_REFRESH_PREFIX):]
        try:
            n = int(suffix)
        except ValueError:
            raise AuthenticationError("Invalid refresh token")
        return DEV_USER, DEV_TOKEN, f"dev-refresh-token-{n + 1:03d}", 300

    async def revoke_session(self, access_token: str) -> None:
        pass

    async def get_logout_url(self) -> str:
        return "/"
