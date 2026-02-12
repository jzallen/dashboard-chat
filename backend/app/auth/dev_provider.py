from .types import AuthUser

DEV_USER = AuthUser(id="dev-user-001", email="dev@localhost", org_id="dev-org-001", name="Dev User")
DEV_TOKEN = "dev-token-static"


class DevAuthProvider:
    """Auth provider for local development -- no network calls needed."""

    async def verify_token(self, token: str) -> AuthUser:
        if token == DEV_TOKEN:
            return DEV_USER
        from .exceptions import AuthenticationError
        raise AuthenticationError("Invalid dev token")

    async def get_login_url(self, redirect_uri: str) -> str:
        return f"{redirect_uri}?code=dev-auth-code"

    async def handle_callback(self, code: str) -> tuple[AuthUser, str]:
        return DEV_USER, DEV_TOKEN

    async def get_logout_url(self) -> str:
        return "/"
