"""Tests for the Stream.io token endpoint."""

from unittest.mock import patch

import jwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dev_provider import _mint_jwt
from app.main import app

TEST_STREAM_SECRET = "stream-test-secret-key"
TEST_STREAM_KEY = "stream-test-api-key"


@pytest.fixture
def stream_configured():
    """Patch settings to include Stream config."""
    with patch("app.routers.stream_token.get_settings") as mock:
        settings = mock.return_value
        settings.stream_api_key = TEST_STREAM_KEY
        settings.stream_api_secret = TEST_STREAM_SECRET
        yield mock


@pytest.fixture
def stream_unconfigured():
    """Patch settings with empty Stream config."""
    with patch("app.routers.stream_token.get_settings") as mock:
        settings = mock.return_value
        settings.stream_api_key = ""
        settings.stream_api_secret = ""
        yield mock


class TestStreamToken:
    async def test_authenticated_returns_valid_jwt(self, stream_configured):
        """Authenticated user gets a valid Stream JWT."""
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/stream/stream-token",
                headers={"Authorization": f"Bearer {_mint_jwt()}"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "token" in data

        decoded = jwt.decode(data["token"], TEST_STREAM_SECRET, algorithms=["HS256"])
        assert decoded["user_id"] == "dev-user-001"
        assert "iat" in decoded
        assert "exp" in decoded

    async def test_unauthenticated_returns_401(self, stream_configured):
        """Request without Bearer token returns 401 from middleware."""
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/stream/stream-token")

        assert response.status_code == 401

    async def test_unconfigured_returns_503(self, stream_unconfigured):
        """Missing Stream config returns 503."""
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/stream/stream-token",
                headers={"Authorization": f"Bearer {_mint_jwt()}"},
            )

        assert response.status_code == 503
        assert response.json()["detail"] == "Stream.io is not configured"
