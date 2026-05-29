import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

# Identity headers auth-proxy injects after it has verified the caller upstream.
PROXY_HEADERS = {
    "X-User-Id": "dev-user-001",
    "X-Org-Id": "dev-org-001",
    "X-User-Email": "dev@localhost",
}


@pytest.fixture
def client():
    """Create an httpx AsyncClient bound to the FastAPI app."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


class TestAuthMiddleware:
    """AuthMiddleware is a pure resource server (ADR-016 / ADR-043): it trusts
    the auth-proxy-injected identity headers and never verifies JWTs."""

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

    async def test_protected_route_without_identity_headers_returns_401(self, client: AsyncClient):
        """A protected route with no auth-proxy identity headers is rejected."""
        async with client:
            res = await client.get("/api/projects")
        assert res.status_code == 401

    async def test_protected_route_with_identity_headers_passes(self, client: AsyncClient):
        """A protected route given the auth-proxy identity headers passes the
        auth layer (downstream may return non-2xx for other reasons, but not a
        401 from auth)."""
        async with client:
            res = await client.get("/api/projects", headers=PROXY_HEADERS)
        assert res.status_code != 401
