"""WorkOS AuthKit provider implementation."""

import logging
import httpx
import jwt
from jwt import PyJWKClient

from .types import AuthUser
from .exceptions import AuthenticationError

logger = logging.getLogger(__name__)


class WorkOSAuthProvider:
    """Auth provider using WorkOS AuthKit."""

    def __init__(self, settings):
        self.api_key = settings.workos_api_key
        self.client_id = settings.workos_client_id
        self.redirect_uri = settings.workos_redirect_uri
        self._jwks_client = PyJWKClient(
            f"https://api.workos.com/sso/jwks/{self.client_id}"
        )

    async def verify_token(self, token: str) -> AuthUser:
        """Verify a WorkOS access token (JWT) using JWKS."""
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                options={"verify_aud": False},
            )
        except jwt.ExpiredSignatureError:
            raise AuthenticationError("Token has expired")
        except jwt.InvalidTokenError as e:
            logger.error("JWT verification failed: %s", e)
            raise AuthenticationError(f"Invalid token: {e}")

        return AuthUser(
            id=payload.get("sub", ""),
            email=payload.get("email", ""),
            # TODO: prompt user to create/join an org when org_id is missing
            org_id=payload.get("org_id") or payload.get("sub", ""),
            name=payload.get("first_name", ""),
        )

    async def get_login_url(self, redirect_uri: str) -> str:
        """Get WorkOS AuthKit login URL."""
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "provider": "authkit",
        }
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        return f"https://api.workos.com/user_management/authorize?{qs}"

    async def handle_callback(self, code: str) -> tuple[AuthUser, str]:
        """Exchange authorization code for user and token."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.workos.com/user_management/authenticate",
                json={
                    "client_id": self.client_id,
                    "client_secret": self.api_key,
                    "code": code,
                    "grant_type": "authorization_code",
                },
            )
            if resp.status_code != 200:
                raise AuthenticationError(f"WorkOS callback failed: {resp.text}")
            data = resp.json()
            user_data = data.get("user", {})
            # TODO: prompt user to create/join an org when organization_id is missing
            org_id = data.get("organization_id") or user_data.get("id", "")
            user = AuthUser(
                id=user_data["id"],
                email=user_data["email"],
                org_id=org_id,
                name=user_data.get("first_name", ""),
            )
            return user, data["access_token"]

    async def get_logout_url(self) -> str:
        return "/"
