"""Tests for the dbt export API route handler."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import set_auth_user
from app.auth.exceptions import AuthorizationError
from app.auth.types import AuthUser
from app.main import app
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.use_cases.project.exceptions import ProjectNotFound
from tests.uuidv7_fixtures import (
    DATASET_ROUTE_1,
    ORG_ROUTE,
    PROJECT_ROUTE_1,
    USER_ROUTE,
)

TEST_USER = AuthUser(id=USER_ROUTE, email="test@test.com", org_id=ORG_ROUTE, name="Test")


@pytest.fixture
async def seeded_db_for_route(db_session: AsyncSession):
    """Seed database for route tests.

    NOTE: Currently available for future integration tests. HTTP tests via
    AsyncClient use the app's own DB session from use_db_context middleware,
    so this fixture cannot inject its session into the HTTP pipeline. For full
    integration testing, configure the app to use a shared test database session.
    """
    set_auth_user(TEST_USER)

    project = ProjectRecord(
        id=PROJECT_ROUTE_1,
        name="Route Test",
        org_id=ORG_ROUTE,
    )
    db_session.add(project)

    ds = DatasetRecord(
        id=DATASET_ROUTE_1,
        project_id=PROJECT_ROUTE_1,
        name="Test Dataset",
        schema_config={"fields": {"col_a": {"type": "text"}}},
    )
    db_session.add(ds)

    await db_session.commit()
    return db_session


class TestExportDbtRoute:
    async def test_success_returns_zip_with_correct_headers(self):
        """Successful export returns 200 with application/zip and Content-Disposition."""
        zip_bytes = b"PK\x03\x04fake-zip-content"

        with patch("app.routers.projects.export_dbt_project", new_callable=AsyncMock) as mock_uc:
            mock_uc.return_value = Success((zip_bytes, "test_project"))

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    "/api/projects/proj-1/export/dbt",
                    headers={"Authorization": "Bearer dev-token-static"},
                )

            assert response.status_code == 200
            assert response.headers["content-type"] == "application/zip"
            assert 'filename="test_project_dbt.zip"' in response.headers["content-disposition"]
            assert response.content == zip_bytes

    async def test_not_found_returns_404_json(self):
        """Missing project returns 404 with RFC 9457 JSON error."""
        with patch("app.routers.projects.export_dbt_project", new_callable=AsyncMock) as mock_uc:
            mock_uc.return_value = Failure(ProjectNotFound("proj-missing"))

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    "/api/projects/proj-missing/export/dbt",
                    headers={"Authorization": "Bearer dev-token-static"},
                )

            assert response.status_code == 404
            body = response.json()
            assert body["type"] == "PROJECT_NOT_FOUND"
            assert body["status"] == 404

    async def test_wrong_org_returns_403_json(self):
        """Authorization error returns 403 with RFC 9457 JSON error."""
        with patch("app.routers.projects.export_dbt_project", new_callable=AsyncMock) as mock_uc:
            mock_uc.return_value = Failure(AuthorizationError("Access denied"))

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    "/api/projects/proj-other/export/dbt",
                    headers={"Authorization": "Bearer dev-token-static"},
                )

            assert response.status_code == 403
            body = response.json()
            assert body["type"] == "ACCESS_DENIED"
            assert body["status"] == 403

    async def test_generic_exception_returns_500_json(self):
        """Generic exceptions return 500 with RFC 9457 JSON error."""
        with patch("app.routers.projects.export_dbt_project", new_callable=AsyncMock) as mock_uc:
            mock_uc.return_value = Failure(RuntimeError("Unexpected"))

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    "/api/projects/proj-1/export/dbt",
                    headers={"Authorization": "Bearer dev-token-static"},
                )

            assert response.status_code == 500
            body = response.json()
            assert body["type"] == "INTERNAL_SERVER_ERROR"
            assert body["detail"] == "An unexpected error occurred."
