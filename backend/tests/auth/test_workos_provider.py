"""Tests for WorkOS auth provider."""

import time
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

        with (
            patch(
                "app.auth.workos_provider.jwt.decode",
                side_effect=pyjwt.ExpiredSignatureError("Signature has expired"),
            ),
            pytest.raises(AuthenticationError, match="Token has expired"),
        ):
            await provider.verify_token("expired.jwt.token")

    async def test_invalid_jwt_raises_authentication_error(self, provider):
        """verify_token should raise AuthenticationError for malformed JWTs."""
        mock_signing_key = MagicMock()
        mock_signing_key.key = "fake-rsa-key"
        provider._jwks_client.get_signing_key_from_jwt = MagicMock(return_value=mock_signing_key)

        with (
            patch(
                "app.auth.workos_provider.jwt.decode",
                side_effect=pyjwt.InvalidTokenError("Invalid token"),
            ),
            pytest.raises(AuthenticationError, match="Invalid token"),
        ):
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

    async def test_verify_token_passes_audience_and_issuer_to_decode(self, provider):
        """verify_token must pass audience and issuer to jwt.decode for security."""
        mock_signing_key = MagicMock()
        mock_signing_key.key = "fake-rsa-key"
        provider._jwks_client.get_signing_key_from_jwt = MagicMock(return_value=mock_signing_key)

        payload = {
            "sub": "user_01ABC",
            "email": "alice@example.com",
            "org_id": "org_01XYZ",
            "first_name": "Alice",
        }

        with patch("app.auth.workos_provider.jwt.decode", return_value=payload) as mock_decode:
            await provider.verify_token("some.jwt.token")

        mock_decode.assert_called_once_with(
            "some.jwt.token",
            "fake-rsa-key",
            algorithms=["RS256"],
            audience="client_test_xyz",
            issuer="https://api.workos.com/user_management/client_test_xyz",
        )


class TestGetLoginUrl:
    """Tests for WorkOSAuthProvider.get_login_url."""

    async def test_constructs_url_with_required_params(self, provider):
        """get_login_url should include client_id, redirect_uri, response_type, provider, scope."""
        url, state = await provider.get_login_url("http://localhost:5173/auth/callback")

        assert "client_id=client_test_xyz" in url
        assert "redirect_uri=" in url
        assert "response_type=code" in url
        assert "provider=authkit" in url
        assert "scope=openid+profile+email" in url
        assert "nonce=" in url
        assert f"state={state}" in url
        assert url.startswith("https://api.workos.com/user_management/authorize?")
        assert len(state) > 0

    async def test_includes_organization_when_provided(self, provider):
        """get_login_url should add organization param when organization_id is given."""
        url, _state = await provider.get_login_url(
            "http://localhost:5173/auth/callback",
            organization_id="org_01XYZ",
        )

        assert "organization=org_01XYZ" in url

    async def test_omits_organization_when_not_provided(self, provider):
        """get_login_url should not include organization param when omitted."""
        url, _state = await provider.get_login_url("http://localhost:5173/auth/callback")

        assert "organization=" not in url


def _make_workos_response(*, status_code=200, text="error", json_data=None):
    """Helper to build a mock httpx response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    if json_data is not None:
        resp.json.return_value = json_data
    return resp


def _mock_httpx_client(mock_response):
    """Context-manager helper that patches httpx.AsyncClient to return mock_response on post()."""
    mock_client_instance = AsyncMock()
    mock_client_instance.post.return_value = mock_response
    return patch(
        "app.auth.workos_provider.httpx.AsyncClient",
        **{
            "return_value.__aenter__": AsyncMock(return_value=mock_client_instance),
            "return_value.__aexit__": AsyncMock(return_value=False),
        },
    ), mock_client_instance


def _workos_auth_json(
    *,
    access_token="tok_abc123",
    refresh_token="rt_xyz789",
    user_id="user_01ABC",
    email="alice@example.com",
    first_name="Alice",
    org_id="org_01XYZ",
    org_name=None,
):
    """Build a realistic WorkOS /authenticate response body."""
    data = {
        "user": {"id": user_id, "email": email, "first_name": first_name},
        "access_token": access_token,
        "refresh_token": refresh_token,
    }
    if org_id is not None:
        data["organization_id"] = org_id
    if org_name is not None:
        data["organization_name"] = org_name
    return data


class TestHandleCallback:
    """Tests for WorkOSAuthProvider.handle_callback."""

    async def test_successful_callback_returns_4_tuple(self, provider):
        """handle_callback should exchange code for user, access_token, refresh_token, expires_in."""
        exp_time = int(time.time()) + 3600
        json_data = _workos_auth_json(access_token="tok_abc123", refresh_token="rt_xyz789")
        mock_response = _make_workos_response(status_code=200, json_data=json_data)
        client_patch, _ = _mock_httpx_client(mock_response)

        with client_patch, patch("app.auth.workos_provider.jwt.decode", return_value={"exp": exp_time}):
            user, token, refresh_token, expires_in = await provider.handle_callback("auth-code-123")

        assert isinstance(user, AuthUser)
        assert user.id == "user_01ABC"
        assert user.email == "alice@example.com"
        assert user.org_id == "org_01XYZ"
        assert user.name == "Alice"
        assert token == "tok_abc123"
        assert refresh_token == "rt_xyz789"
        assert 3590 <= expires_in <= 3600

    async def test_failed_callback_raises_authentication_error(self, provider):
        """handle_callback should raise AuthenticationError on non-200 response."""
        mock_response = _make_workos_response(status_code=400, text="invalid_grant")
        client_patch, _ = _mock_httpx_client(mock_response)

        with client_patch, pytest.raises(AuthenticationError, match="WorkOS callback failed"):
            await provider.handle_callback("bad-code")

    async def test_callback_without_org_id_returns_none_org(self, provider):
        """handle_callback should set org_id=None when response has no organization_id."""
        exp_time = int(time.time()) + 3600
        json_data = _workos_auth_json(org_id=None)
        mock_response = _make_workos_response(status_code=200, json_data=json_data)
        client_patch, _ = _mock_httpx_client(mock_response)

        with client_patch, patch("app.auth.workos_provider.jwt.decode", return_value={"exp": exp_time}):
            user, _, _, _ = await provider.handle_callback("code-no-org")

        assert user.org_id is None


class TestRefreshAccessToken:
    """Tests for WorkOSAuthProvider.refresh_access_token."""

    async def test_successful_refresh_returns_4_tuple(self, provider):
        """refresh_access_token should return new user, access_token, refresh_token, expires_in."""
        exp_time = int(time.time()) + 1800
        json_data = _workos_auth_json(
            access_token="tok_new",
            refresh_token="rt_new",
        )
        mock_response = _make_workos_response(status_code=200, json_data=json_data)
        client_patch, mock_client = _mock_httpx_client(mock_response)

        with client_patch, patch("app.auth.workos_provider.jwt.decode", return_value={"exp": exp_time}):
            user, token, refresh_token, expires_in = await provider.refresh_access_token("rt_old")

        assert isinstance(user, AuthUser)
        assert token == "tok_new"
        assert refresh_token == "rt_new"
        assert 1790 <= expires_in <= 1800

        # Verify the correct grant_type was used
        call_kwargs = mock_client.post.call_args
        body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert body["grant_type"] == "urn:workos:oauth:grant-type:refresh-token"
        assert body["refresh_token"] == "rt_old"

    async def test_failed_refresh_raises_authentication_error(self, provider):
        """refresh_access_token should raise AuthenticationError on non-200."""
        mock_response = _make_workos_response(status_code=401, text="invalid_refresh_token")
        client_patch, _ = _mock_httpx_client(mock_response)

        with client_patch, pytest.raises(AuthenticationError, match="Token refresh failed"):
            await provider.refresh_access_token("rt_expired")


class TestRevokeSession:
    """Tests for WorkOSAuthProvider.revoke_session."""

    async def test_successful_revocation(self, provider):
        """revoke_session should extract sid from JWT and send it to WorkOS."""
        mock_response = _make_workos_response(status_code=200)
        client_patch, mock_client = _mock_httpx_client(mock_response)

        with (
            client_patch,
            patch(
                "app.auth.workos_provider.jwt.decode",
                return_value={"sid": "session_abc123"},
            ),
        ):
            await provider.revoke_session("some.access.token")

        mock_client.post.assert_called_once_with(
            "https://api.workos.com/user_management/sessions/revoke",
            json={"session_id": "session_abc123"},
            headers={"Authorization": "Bearer sk_test_abc123"},
            timeout=5.0,
        )

    async def test_non_200_response_is_logged_not_raised(self, provider):
        """revoke_session should not raise on non-200 responses."""
        mock_response = _make_workos_response(status_code=400, text="bad request")
        client_patch, _ = _mock_httpx_client(mock_response)

        with (
            client_patch,
            patch(
                "app.auth.workos_provider.jwt.decode",
                return_value={"sid": "session_abc123"},
            ),
        ):
            # Should not raise
            await provider.revoke_session("some.access.token")

    async def test_network_error_is_logged_not_raised(self, provider):
        """revoke_session should swallow network errors."""
        mock_client_instance = AsyncMock()
        mock_client_instance.post.side_effect = httpx.ConnectError("connection refused")
        client_patch = patch(
            "app.auth.workos_provider.httpx.AsyncClient",
            **{
                "return_value.__aenter__": AsyncMock(return_value=mock_client_instance),
                "return_value.__aexit__": AsyncMock(return_value=False),
            },
        )

        with (
            client_patch,
            patch(
                "app.auth.workos_provider.jwt.decode",
                return_value={"sid": "session_abc123"},
            ),
        ):
            # Should not raise
            await provider.revoke_session("some.access.token")

    async def test_missing_sid_claim_skips_revocation(self, provider):
        """revoke_session should not call WorkOS API when sid is missing from JWT."""
        with (
            patch(
                "app.auth.workos_provider.jwt.decode",
                return_value={},
            ),
            patch("app.auth.workos_provider.httpx.AsyncClient") as mock_async_client,
        ):
            await provider.revoke_session("some.access.token")

        # httpx.AsyncClient should never have been used as a context manager
        mock_async_client.return_value.__aenter__.assert_not_called()


class TestGetLogoutUrl:
    """Tests for WorkOSAuthProvider.get_logout_url."""

    async def test_returns_root(self, provider):
        """get_logout_url should return '/'."""
        url = await provider.get_logout_url()
        assert url == "/"
