"""Tests for auth route endpoints (callback, refresh)."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI

from app.auth.dev_provider import DEV_USER, DevAuthProvider
from app.auth.exceptions import AuthenticationError
from app.auth.rate_limiter import InMemoryRateLimiter
from app.routers.auth import router


@pytest.fixture
def app():
    """Minimal FastAPI app with just the auth router."""
    test_app = FastAPI()
    test_app.include_router(router)
    return test_app


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture(autouse=True)
def _use_dev_provider():
    """Patch get_auth_provider to return DevAuthProvider for all tests."""
    with patch("app.routers.auth.get_auth_provider", return_value=DevAuthProvider()):
        yield


@pytest.fixture(autouse=True)
def _stub_org_helpers():
    """Stub out enrich_org_id and ensure_org_provisioned (they need DB)."""

    async def passthrough(user):
        return user

    async def noop(user):
        pass

    with (
        patch("app.routers.auth.enrich_org_id", side_effect=passthrough),
        patch("app.routers.auth.ensure_org_provisioned", side_effect=noop),
    ):
        yield


@pytest.fixture(autouse=True)
def _fresh_rate_limiter():
    """Replace the global refresh_limiter with a fresh instance for each test."""
    fresh = InMemoryRateLimiter(window_seconds=10)
    with patch("app.routers.auth.refresh_limiter", fresh):
        yield fresh


class TestCallbackResponse:
    """Tests for POST /api/auth/callback response shape."""

    async def test_callback_includes_refresh_token_and_expires_in(self, client):
        """callback should return refresh_token and expires_in alongside user and token."""
        resp = await client.post("/api/auth/callback", json={"code": "any-code"})
        assert resp.status_code == 200
        data = resp.json()
        # Token is now a real RS256 JWT (3 dot-separated segments)
        assert data["token"].count(".") == 2
        assert data["refresh_token"] == "dev-refresh-token-001"
        assert data["expires_in"] == 300
        assert data["user"]["id"] == DEV_USER.id
        assert data["user"]["email"] == DEV_USER.email

    async def test_callback_auth_error_returns_401(self, client):
        """callback should return 401 when provider raises AuthenticationError."""
        failing_provider = MagicMock()
        failing_provider.handle_callback = AsyncMock(side_effect=AuthenticationError("bad code"))
        with patch("app.routers.auth.get_auth_provider", return_value=failing_provider):
            resp = await client.post("/api/auth/callback", json={"code": "bad"})
        assert resp.status_code == 401


class TestRefreshEndpoint:
    """Tests for POST /api/auth/refresh."""

    async def test_successful_refresh(self, client):
        """refresh should return new tokens on valid refresh_token."""
        resp = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": "dev-refresh-token-001"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"].count(".") == 2
        assert data["refresh_token"] == "dev-refresh-token-002"
        assert data["expires_in"] == 300

    async def test_invalid_refresh_token_returns_401(self, client):
        """refresh should return 401 for an invalid refresh token."""
        resp = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": "totally-invalid"},
        )
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Refresh token invalid or expired"

    async def test_rate_limiting_returns_429(self, client, _fresh_rate_limiter):
        """refresh should return 429 when called too frequently from same IP."""
        # First request should succeed
        resp1 = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": "dev-refresh-token-001"},
        )
        assert resp1.status_code == 200

        # Second request within the window should be rate limited
        resp2 = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": "dev-refresh-token-002"},
        )
        assert resp2.status_code == 429
        assert resp2.json()["detail"] == "Too many refresh requests"

    async def test_rate_limit_allows_after_window(self, client, _fresh_rate_limiter):
        """refresh should allow requests after the rate limit window passes."""
        resp1 = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": "dev-refresh-token-001"},
        )
        assert resp1.status_code == 200

        # Manually expire the timestamp to simulate window passing
        for key in _fresh_rate_limiter._timestamps:
            _fresh_rate_limiter._timestamps[key] -= 11

        resp2 = await client.post(
            "/api/auth/refresh",
            json={"refresh_token": "dev-refresh-token-002"},
        )
        assert resp2.status_code == 200


class TestLogoutEndpoint:
    """Tests for POST /api/auth/logout."""

    async def test_logout_with_bearer_token_calls_revoke_session(self, client):
        """logout with a Bearer token should call revoke_session and return success."""
        mock_provider = MagicMock()
        mock_provider.revoke_session = AsyncMock()
        mock_provider.get_logout_url = AsyncMock(return_value="/")
        with patch("app.routers.auth.get_auth_provider", return_value=mock_provider):
            resp = await client.post(
                "/api/auth/logout",
                headers={"Authorization": "Bearer my-access-token"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["url"] == "/"
        mock_provider.revoke_session.assert_awaited_once_with("my-access-token")

    async def test_logout_without_token_skips_revocation(self, client):
        """logout without Authorization header should skip revocation and return success."""
        mock_provider = MagicMock()
        mock_provider.revoke_session = AsyncMock()
        mock_provider.get_logout_url = AsyncMock(return_value="/")
        with patch("app.routers.auth.get_auth_provider", return_value=mock_provider):
            resp = await client.post("/api/auth/logout")
        assert resp.status_code == 200
        data = resp.json()
        assert data["url"] == "/"
        mock_provider.revoke_session.assert_not_awaited()

    async def test_logout_always_returns_url(self, client):
        """logout should always return a JSON body with 'url' key."""
        resp = await client.post("/api/auth/logout")
        assert resp.status_code == 200
        data = resp.json()
        assert "url" in data
        assert data["url"] == "/"


class TestLoginEndpoint:
    """Tests for GET /api/auth/login."""

    async def test_login_response_includes_url_and_state(self, client):
        """login should return both 'url' and 'state' fields."""
        resp = await client.get("/api/auth/login")
        assert resp.status_code == 200
        data = resp.json()
        assert "url" in data
        assert "state" in data
        assert len(data["state"]) > 0
        assert data["url"].startswith("http")


class TestRateLimiter:
    """Unit tests for InMemoryRateLimiter."""

    def test_first_request_is_allowed(self):
        limiter = InMemoryRateLimiter(window_seconds=5)
        assert limiter.check("ip1") is True

    def test_second_request_within_window_is_blocked(self):
        limiter = InMemoryRateLimiter(window_seconds=5)
        limiter.check("ip1")
        assert limiter.check("ip1") is False

    def test_different_keys_are_independent(self):
        limiter = InMemoryRateLimiter(window_seconds=5)
        limiter.check("ip1")
        assert limiter.check("ip2") is True

    def test_request_allowed_after_window(self):
        limiter = InMemoryRateLimiter(window_seconds=1)
        limiter.check("ip1")
        # Manually backdate the timestamp
        limiter._timestamps["ip1"] -= 2
        assert limiter.check("ip1") is True

    def test_stale_entries_are_cleaned(self):
        limiter = InMemoryRateLimiter(window_seconds=1)
        limiter._timestamps["old_ip"] = time.time() - 100
        limiter.check("new_ip")
        assert "old_ip" not in limiter._timestamps
