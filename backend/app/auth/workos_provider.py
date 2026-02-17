"""WorkOS AuthKit provider implementation."""

import asyncio
import logging
import time
import urllib.parse

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
            signing_key = await asyncio.to_thread(
                self._jwks_client.get_signing_key_from_jwt, token
            )
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                options={"verify_aud": False},
            )
            # Warn if the token lacks an audience claim so we know when
            # WorkOS starts including it and we can enforce verification.
            if "aud" not in payload:
                logger.warning("WorkOS token missing 'aud' claim — audience verification skipped")
            elif payload.get("aud") != self.client_id:
                raise jwt.InvalidTokenError(
                    f"Audience mismatch: expected {self.client_id}, got {payload.get('aud')}"
                )
        except jwt.ExpiredSignatureError:
            raise AuthenticationError("Token has expired")
        except jwt.InvalidTokenError as e:
            logger.error("JWT verification failed: %s", e)
            raise AuthenticationError(f"Invalid token: {e}")

        return AuthUser(
            id=payload.get("sub", ""),
            email=payload.get("email", ""),
            org_id=payload.get("org_id") or None,
            name=payload.get("first_name", ""),
            org_name=payload.get("org_name") or None,
        )

    async def get_login_url(self, redirect_uri: str, *, organization_id: str | None = None) -> str:
        """Get WorkOS AuthKit login URL."""
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "provider": "authkit",
        }
        if organization_id:
            params["organization"] = organization_id
        qs = urllib.parse.urlencode(params)
        return f"https://api.workos.com/user_management/authorize?{qs}"

    def _parse_auth_response(self, data: dict) -> tuple[AuthUser, str, str, int]:
        """Parse a WorkOS authenticate response into the standard 4-tuple."""
        user_data = data.get("user", {})
        org_id = data.get("organization_id") or None
        org_name = data.get("organization_name") or None
        user = AuthUser(
            id=user_data["id"],
            email=user_data["email"],
            org_id=org_id,
            name=user_data.get("first_name", ""),
            org_name=org_name,
        )
        access_token = data["access_token"]
        refresh_token = data["refresh_token"]
        # Decode exp claim without signature verification to compute expires_in
        decoded = jwt.decode(access_token, options={"verify_signature": False})
        expires_in = decoded["exp"] - int(time.time())
        return user, access_token, refresh_token, expires_in

    async def handle_callback(self, code: str) -> tuple[AuthUser, str, str, int]:
        """Exchange authorization code for user and tokens."""
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
            return self._parse_auth_response(resp.json())

    async def refresh_access_token(self, refresh_token: str) -> tuple[AuthUser, str, str, int]:
        """Exchange a refresh token for new access and refresh tokens."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.workos.com/user_management/authenticate",
                json={
                    "client_id": self.client_id,
                    "client_secret": self.api_key,
                    "refresh_token": refresh_token,
                    "grant_type": "urn:workos:oauth:grant-type:refresh-token",
                },
            )
            if resp.status_code != 200:
                raise AuthenticationError(f"Token refresh failed: {resp.text}")
            return self._parse_auth_response(resp.json())

    async def get_logout_url(self) -> str:
        return "/"
