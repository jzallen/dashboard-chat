"""Tests for WorkOS auth provider."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import jwt as pyjwt
import pytest

from app.auth.exceptions import AuthenticationError
from app.auth.types import AuthUser
from app.auth.workos_provider import WorkOSAuthProvider


@pytest.fixture
def mock_settings():
    """Minimal settings stub for WorkOSAuthProvider."""
    settings = MagicMock()
    settings.workos_api_key = "sk_test_abc123"
    settings.workos_client_id = "client_test_xyz"
    settings.workos_redirect_uri = "http://localhost:5173/auth/callback"
    return settings


@pytest.fixture
def provider(mock_settings):
    """Create a WorkOSAuthProvider with mocked JWKS client."""
    with patch("app.auth.workos_provider.PyJWKClient"):
        return WorkOSAuthProvider(mock_settings)


class TestVerifyToken:
    """Tests for WorkOSAuthProvider.verify_token."""

    async def test_valid_jwt_returns_auth_user(self, provider):
        """verify_token should decode a valid JWT and return an AuthUser."""
        mock_signing_key = MagicMock()
        mock_signing_key.key = "fake-rsa-key"
        provider._jwks_client.get_signing_key_from_jwt = MagicMock(return_value=mock_signing_key)

        payload = {
            "sub": "user_01ABC",
            "email": "alice@example.com",
            "org_id": "org_01XYZ",
            "first_name": "Alice",
        }

        with patch("app.auth.workos_provider.jwt.decode", return_value=payload):
            result = await provider.verify_token("valid.jwt.token")

        assert isinstance(result, AuthUser)
        assert result.id == "user_01ABC"
        assert result.email == "alice@example.com"
        assert result.org_id == "org_01XYZ"
        assert result.name == "Alice"

    async def test_expired_jwt_raises_authentication_error(self, provider):
        """verify_token should raise AuthenticationError for expired JWTs."""
        mock_signing_key = MagicMock()
        mock_signing_key.key = "fake-rsa-key"
        provider._jwks_client.get_signing_key_from_jwt = MagicMock(return_value=mock_signing_key)

        with patch(
            "app.auth.workos_provider.jwt.decode",
            side_effect=pyjwt.ExpiredSignatureError("Signature has expired"),
        ):
            with pytest.raises(AuthenticationError, match="Token has expired"):
                await provider.verify_token("expired.jwt.token")

    async def test_invalid_jwt_raises_authentication_error(self, provider):
        """verify_token should raise AuthenticationError for malformed JWTs."""
        mock_signing_key = MagicMock()
        mock_signing_key.key = "fake-rsa-key"
        provider._jwks_client.get_signing_key_from_jwt = MagicMock(return_value=mock_signing_key)

        with patch(
            "app.auth.workos_provider.jwt.decode",
            side_effect=pyjwt.InvalidTokenError("Invalid token"),
        ):
            with pytest.raises(AuthenticationError, match="Invalid token"):
                await provider.verify_token("garbage.token")

    async def test_missing_org_id_returns_none_org(self, provider):
        """verify_token should return org_id=None when JWT has no org_id."""
        mock_signing_key = MagicMock()
        mock_signing_key.key = "fake-rsa-key"
        provider._jwks_client.get_signing_key_from_jwt = MagicMock(return_value=mock_signing_key)

        payload = {
            "sub": "user_01ABC",
            "email": "alice@example.com",
            # org_id intentionally absent
            "first_name": "Alice",
        }

        with patch("app.auth.workos_provider.jwt.decode", return_value=payload):
            result = await provider.verify_token("valid.jwt.no-org")

        assert result.org_id is None


class TestGetLoginUrl:
    """Tests for WorkOSAuthProvider.get_login_url."""

    async def test_constructs_url_with_required_params(self, provider):
        """get_login_url should include client_id, redirect_uri, response_type, provider."""
        url = await provider.get_login_url("http://localhost:5173/auth/callback")

        assert "client_id=client_test_xyz" in url
        assert "redirect_uri=" in url
        assert "response_type=code" in url
        assert "provider=authkit" in url
        assert url.startswith("https://api.workos.com/user_management/authorize?")

    async def test_includes_organization_when_provided(self, provider):
        """get_login_url should add organization param when organization_id is given."""
        url = await provider.get_login_url(
            "http://localhost:5173/auth/callback",
            organization_id="org_01XYZ",
        )

        assert "organization=org_01XYZ" in url

    async def test_omits_organization_when_not_provided(self, provider):
        """get_login_url should not include organization param when omitted."""
        url = await provider.get_login_url("http://localhost:5173/auth/callback")

        assert "organization=" not in url


class TestHandleCallback:
    """Tests for WorkOSAuthProvider.handle_callback."""

    async def test_successful_callback_returns_user_and_token(self, provider):
        """handle_callback should exchange code for user and access token."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "user": {
                "id": "user_01ABC",
                "email": "alice@example.com",
                "first_name": "Alice",
            },
            "organization_id": "org_01XYZ",
            "access_token": "tok_abc123",
        }

        with patch("app.auth.workos_provider.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            user, token = await provider.handle_callback("auth-code-123")

        assert isinstance(user, AuthUser)
        assert user.id == "user_01ABC"
        assert user.email == "alice@example.com"
        assert user.org_id == "org_01XYZ"
        assert user.name == "Alice"
        assert token == "tok_abc123"

    async def test_failed_callback_raises_authentication_error(self, provider):
        """handle_callback should raise AuthenticationError on non-200 response."""
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = "invalid_grant"

        with patch("app.auth.workos_provider.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            with pytest.raises(AuthenticationError, match="WorkOS callback failed"):
                await provider.handle_callback("bad-code")

    async def test_callback_without_org_id_returns_none_org(self, provider):
        """handle_callback should set org_id=None when response has no organization_id."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "user": {
                "id": "user_01ABC",
                "email": "alice@example.com",
            },
            "access_token": "tok_abc123",
        }

        with patch("app.auth.workos_provider.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            user, token = await provider.handle_callback("code-no-org")

        assert user.org_id is None


class TestGetLogoutUrl:
    """Tests for WorkOSAuthProvider.get_logout_url."""

    async def test_returns_root(self, provider):
        """get_logout_url should return '/'."""
        url = await provider.get_logout_url()
        assert url == "/"
