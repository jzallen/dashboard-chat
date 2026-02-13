"""Integration tests for authenticated API endpoints.

These tests exercise the full ASGI stack (middleware -> router -> controller -> use case)
using the dev auth provider. Requires a running PostgreSQL instance.

Run with: RUN_INTEGRATION_TESTS=1 pytest tests/integration/
"""

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("RUN_INTEGRATION_TESTS"),
    reason="Set RUN_INTEGRATION_TESTS=1 to run integration tests (requires PostgreSQL)",
)

from httpx import ASGITransport, AsyncClient

from app.main import app
from app.auth.dev_provider import DEV_TOKEN


@pytest.fixture
def client():
    """Create an httpx AsyncClient bound to the FastAPI ASGI app."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


class TestProjectCRUD:
    """End-to-end tests for the project endpoints."""

    @property
    def auth_headers(self):
        return {"Authorization": f"Bearer {_get_dev_token()}"}

    async def test_create_project(self, client: AsyncClient):
        """POST /api/projects should create a project and return 201."""
        async with client:
            res = await client.post(
                "/api/projects",
                json={"name": "Integration Test Project", "description": "Created by test"},
                headers=self.auth_headers,
            )
        assert res.status_code == 201
        body = res.json()
        assert body["data"]["name"] == "Integration Test Project"
        assert body["data"]["description"] == "Created by test"
        assert "id" in body["data"]

    async def test_get_project(self, client: AsyncClient):
        """GET /api/projects/:id should return the created project."""
        async with client:
            # Create first
            create_res = await client.post(
                "/api/projects",
                json={"name": "Fetch Me"},
                headers=self.auth_headers,
            )
            project_id = create_res.json()["data"]["id"]

            # Fetch
            get_res = await client.get(
                f"/api/projects/{project_id}",
                headers=self.auth_headers,
            )
        assert get_res.status_code == 200
        body = get_res.json()
        assert body["data"]["id"] == project_id
        assert body["data"]["name"] == "Fetch Me"

    async def test_update_project(self, client: AsyncClient):
        """PATCH /api/projects/:id should update the project name."""
        async with client:
            # Create
            create_res = await client.post(
                "/api/projects",
                json={"name": "Before Update"},
                headers=self.auth_headers,
            )
            project_id = create_res.json()["data"]["id"]

            # Update
            patch_res = await client.patch(
                f"/api/projects/{project_id}",
                json={"name": "After Update"},
                headers=self.auth_headers,
            )
        assert patch_res.status_code == 200
        body = patch_res.json()
        assert body["data"]["name"] == "After Update"

    async def test_list_projects(self, client: AsyncClient):
        """GET /api/projects should return a list including the created project."""
        async with client:
            await client.post(
                "/api/projects",
                json={"name": "Listed Project"},
                headers=self.auth_headers,
            )

            list_res = await client.get("/api/projects", headers=self.auth_headers)
        assert list_res.status_code == 200
        body = list_res.json()
        names = [p["name"] for p in body["data"]]
        assert "Listed Project" in names

    async def test_delete_project(self, client: AsyncClient):
        """DELETE /api/projects/:id should delete and return 200."""
        async with client:
            create_res = await client.post(
                "/api/projects",
                json={"name": "To Delete"},
                headers=self.auth_headers,
            )
            project_id = create_res.json()["data"]["id"]

            del_res = await client.delete(
                f"/api/projects/{project_id}",
                headers=self.auth_headers,
            )
        assert del_res.status_code == 200


class TestAuthRequired:
    """Verify that protected endpoints reject unauthenticated requests."""

    async def test_create_project_without_token_returns_401(self, client: AsyncClient):
        """POST /api/projects without auth should return 401."""
        async with client:
            res = await client.post(
                "/api/projects",
                json={"name": "No Auth"},
            )
        assert res.status_code == 401

    async def test_list_projects_with_bad_token_returns_401(self, client: AsyncClient):
        """GET /api/projects with invalid token should return 401."""
        async with client:
            res = await client.get(
                "/api/projects",
                headers={"Authorization": "Bearer invalid-token"},
            )
        assert res.status_code == 401
