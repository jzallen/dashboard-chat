import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dev_provider import _mint_jwt
from app.main import app


@pytest.fixture
def dev_token():
    """Mint a fresh RS256 JWT for test requests."""
    return _mint_jwt()


@pytest.fixture
def client():
    """Create an httpx AsyncClient bound to the FastAPI app."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


class TestAuthMiddleware:
    """Tests for AuthMiddleware on the FastAPI app."""

    async def test_health_accessible_without_token(self, client: AsyncClient):
        """Public route /health should be accessible without auth."""
        async with client:
            res = await client.get("/health")
        assert res.status_code == 200

    async def test_root_accessible_without_token(self, client: AsyncClient):
        """Public route / should be accessible without auth."""
        async with client:
            res = await client.get("/")
        assert res.status_code == 200

    async def test_docs_accessible_without_token(self, client: AsyncClient):
        """Public route /docs should be accessible without auth."""
        async with client:
            res = await client.get("/docs")
        assert res.status_code == 200

    async def test_auth_login_accessible_without_token(self, client: AsyncClient):
        """Public route /auth/login should be accessible without auth."""
        async with client:
            res = await client.get("/api/auth/login")
        assert res.status_code == 200

    async def test_jwks_accessible_without_token(self, client: AsyncClient):
        """Public route /.well-known/jwks.json should be accessible without auth."""
        async with client:
            res = await client.get("/.well-known/jwks.json")
        assert res.status_code == 200
        data = res.json()
        assert "keys" in data
        assert len(data["keys"]) == 1
        assert data["keys"][0]["kid"] == "dev-key-1"

    async def test_protected_route_without_token_returns_401(self, client: AsyncClient):
        """Protected route without Authorization header should return 401."""
        async with client:
            res = await client.get("/api/projects")
        assert res.status_code == 401
        assert "Authorization" in res.json()["detail"]

    async def test_protected_route_with_invalid_token_returns_401(self, client: AsyncClient):
        """Protected route with invalid token should return 401."""
        async with client:
            res = await client.get(
                "/api/projects",
                headers={"Authorization": "Bearer bad-token"},
            )
        assert res.status_code == 401
        assert "Invalid" in res.json()["detail"]

    async def test_protected_route_with_valid_dev_token_passes(self, client: AsyncClient, dev_token: str):
        """Protected route with valid dev JWT should succeed."""
        async with client:
            res = await client.get(
                "/api/projects",
                headers={"Authorization": f"Bearer {dev_token}"},
            )
        # Should not be 401 — the auth layer passes; downstream may return
        # other status codes depending on DB state, but not 401.
        assert res.status_code != 401
