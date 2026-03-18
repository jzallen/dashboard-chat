"""Integration tests for authenticated API endpoints.

These tests exercise the full ASGI stack (middleware -> router -> controller -> use case)
using the dev auth provider. Requires a running PostgreSQL instance.

Run with: RUN_INTEGRATION_TESTS=1 pytest tests/integration/
"""

import os

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dev_provider import _mint_jwt
from app.main import app

pytestmark = pytest.mark.skipif(
    not os.environ.get("RUN_INTEGRATION_TESTS"),
    reason="Set RUN_INTEGRATION_TESTS=1 to run integration tests (requires PostgreSQL)",
)


def _get_dev_token() -> str:
    """Mint a fresh RS256 JWT for integration tests."""
    return _mint_jwt()


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
        assert body["data"]["attributes"]["name"] == "Integration Test Project"
        assert body["data"]["attributes"]["description"] == "Created by test"
        assert body["data"]["id"] is not None

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
        assert body["data"]["attributes"]["name"] == "Fetch Me"
        assert body["data"]["type"] == "projects"

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
        assert body["data"]["attributes"]["name"] == "After Update"

    async def test_list_projects(self, client: AsyncClient):
        """GET /api/projects should return a JSON:API list with pagination meta."""
        async with client:
            await client.post(
                "/api/projects",
                json={"name": "Listed Project"},
                headers=self.auth_headers,
            )

            list_res = await client.get("/api/projects", headers=self.auth_headers)
        assert list_res.status_code == 200
        body = list_res.json()
        # JSON:API envelope
        assert "data" in body
        assert "links" in body
        assert "meta" in body
        assert "page" in body["meta"]
        names = [p["attributes"]["name"] for p in body["data"]]
        assert "Listed Project" in names

    async def test_list_projects_with_page_size(self, client: AsyncClient):
        """GET /api/projects?page[size]=1 should limit results."""
        async with client:
            await client.post(
                "/api/projects",
                json={"name": "Page Size Test 1"},
                headers=self.auth_headers,
            )
            await client.post(
                "/api/projects",
                json={"name": "Page Size Test 2"},
                headers=self.auth_headers,
            )

            list_res = await client.get(
                "/api/projects",
                params={"page[size]": 1},
                headers=self.auth_headers,
            )
        assert list_res.status_code == 200
        body = list_res.json()
        assert len(body["data"]) == 1
        assert body["meta"]["page"]["has_more"] is True
        assert body["links"]["next"] is not None

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


class TestViewCRUD:
    """End-to-end tests for the view endpoints."""

    @property
    def auth_headers(self):
        return {"Authorization": f"Bearer {_get_dev_token()}"}

    async def _create_project(self, client: AsyncClient) -> str:
        """Helper to create a project and return its ID."""
        res = await client.post(
            "/api/projects",
            json={"name": "View Test Project"},
            headers=self.auth_headers,
        )
        return res.json()["data"]["id"]

    async def test_create_view(self, client: AsyncClient):
        """POST /api/projects/:id/views should create a view and return 201."""
        async with client:
            project_id = await self._create_project(client)

            res = await client.post(
                f"/api/projects/{project_id}/views",
                json={
                    "name": "My View",
                    "sql_definition": "SELECT * FROM source",
                    "source_refs": [],
                    "description": "A test view",
                    "materialization": "ephemeral",
                },
                headers=self.auth_headers,
            )
        assert res.status_code == 201
        body = res.json()
        assert body["data"]["attributes"]["name"] == "My View"
        assert body["data"]["attributes"]["sql_definition"] == "SELECT * FROM source"
        assert body["data"]["id"] is not None

    async def test_get_view(self, client: AsyncClient):
        """GET /api/projects/:id/views/:view_id should return the created view."""
        async with client:
            project_id = await self._create_project(client)

            create_res = await client.post(
                f"/api/projects/{project_id}/views",
                json={"name": "Fetch Me", "sql_definition": "SELECT 1"},
                headers=self.auth_headers,
            )
            view_id = create_res.json()["data"]["id"]

            get_res = await client.get(
                f"/api/projects/{project_id}/views/{view_id}",
                headers=self.auth_headers,
            )
        assert get_res.status_code == 200
        body = get_res.json()
        assert body["data"]["id"] == view_id
        assert body["data"]["attributes"]["name"] == "Fetch Me"

    async def test_list_views(self, client: AsyncClient):
        """GET /api/projects/:id/views should return a JSON:API list."""
        async with client:
            project_id = await self._create_project(client)

            await client.post(
                f"/api/projects/{project_id}/views",
                json={"name": "Listed View", "sql_definition": "SELECT 1"},
                headers=self.auth_headers,
            )

            list_res = await client.get(
                f"/api/projects/{project_id}/views",
                headers=self.auth_headers,
            )
        assert list_res.status_code == 200
        body = list_res.json()
        names = [v["attributes"]["name"] for v in body["data"]]
        assert "Listed View" in names

    async def test_update_view(self, client: AsyncClient):
        """PATCH /api/projects/:id/views/:view_id should update the view name."""
        async with client:
            project_id = await self._create_project(client)

            create_res = await client.post(
                f"/api/projects/{project_id}/views",
                json={"name": "Before Update", "sql_definition": "SELECT 1"},
                headers=self.auth_headers,
            )
            view_id = create_res.json()["data"]["id"]

            patch_res = await client.patch(
                f"/api/projects/{project_id}/views/{view_id}",
                json={"name": "After Update"},
                headers=self.auth_headers,
            )
        assert patch_res.status_code == 200
        body = patch_res.json()
        assert body["data"]["attributes"]["name"] == "After Update"

    async def test_delete_view(self, client: AsyncClient):
        """DELETE /api/projects/:id/views/:view_id should delete and return 200."""
        async with client:
            project_id = await self._create_project(client)

            create_res = await client.post(
                f"/api/projects/{project_id}/views",
                json={"name": "To Delete", "sql_definition": "SELECT 1"},
                headers=self.auth_headers,
            )
            view_id = create_res.json()["data"]["id"]

            del_res = await client.delete(
                f"/api/projects/{project_id}/views/{view_id}",
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
