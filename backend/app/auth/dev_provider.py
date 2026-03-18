import time

import jwt

from .dev_keys import get_private_key, get_public_key
from .exceptions import AuthenticationError
from .types import AuthUser

DEV_USER = AuthUser(id="dev-user-001", email="dev@localhost", org_id="dev-org-001", name="Dev User")
DEV_REFRESH_PREFIX = "dev-refresh-token-"

_TOKEN_LIFETIME = 300  # seconds
_AUDIENCE = "dev-client"
_ISSUER = "http://localhost:8000"


def _mint_jwt() -> str:
    """Create a signed RS256 JWT with dev user claims."""
    now = int(time.time())
    payload = {
        "sub": DEV_USER.id,
        "email": DEV_USER.email,
        "org_id": DEV_USER.org_id,
        "name": DEV_USER.name,
        "iat": now,
        "exp": now + _TOKEN_LIFETIME,
        "aud": _AUDIENCE,
        "iss": _ISSUER,
    }
    return jwt.encode(payload, get_private_key(), algorithm="RS256", headers={"kid": "dev-key-1"})


class DevAuthProvider:
    """Auth provider for local development -- uses real RS256 JWTs."""

    async def verify_token(self, token: str) -> AuthUser:
        try:
            payload = jwt.decode(
                token,
                get_public_key(),
                algorithms=["RS256"],
                audience=_AUDIENCE,
                issuer=_ISSUER,
            )
        except jwt.PyJWTError as e:
            raise AuthenticationError(f"Invalid dev token: {e}") from e

        return AuthUser(
            id=payload["sub"],
            email=payload.get("email", ""),
            org_id=payload.get("org_id"),
            name=payload.get("name"),
        )

    async def get_login_url(self, redirect_uri: str, *, organization_id: str | None = None) -> tuple[str, str]:
        return f"{redirect_uri}?code=dev-auth-code", "dev-state-static"

    async def handle_callback(self, code: str) -> tuple[AuthUser, str, str, int]:
        return DEV_USER, _mint_jwt(), "dev-refresh-token-001", _TOKEN_LIFETIME

    async def refresh_access_token(self, refresh_token: str) -> tuple[AuthUser, str, str, int]:
        if not refresh_token.startswith(DEV_REFRESH_PREFIX):
            raise AuthenticationError("Invalid refresh token")
        suffix = refresh_token[len(DEV_REFRESH_PREFIX) :]
        try:
            n = int(suffix)
        except ValueError as err:
            raise AuthenticationError("Invalid refresh token") from err
        return DEV_USER, _mint_jwt(), f"dev-refresh-token-{n + 1:03d}", _TOKEN_LIFETIME

    async def revoke_session(self, access_token: str) -> None:
        pass

    async def get_logout_url(self) -> str:
        return "/"
