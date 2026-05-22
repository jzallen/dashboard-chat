"""Tests for create_organization use case."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from app.use_cases.organization import create_organization
from app.use_cases.organization.exceptions import (
    ExternalServiceError,
    OrganizationNameTakenError,
)
from tests.use_cases.organization.conftest import TEST_USER, TEST_USER_WITH_ORG


class TestCreateOrganization:
    """Tests for create_organization workflow."""

    async def test_create_org_when_dev_mode_returns_org_record(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="Acme Corp", user=TEST_USER)

        match result:
            case Success(data):
                assert data == {
                    "org_id": data["org_id"],
                    "org_name": "Acme Corp",
                }
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_create_org_when_new_org_creates_default_project(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="New Org", user=TEST_USER)

        match result:
            case Success(data):
                org_id = data["org_id"]
                projects = (
                    (await db_session.execute(select(ProjectRecord).where(ProjectRecord.org_id == org_id)))
                    .scalars()
                    .all()
                )
                assert len(projects) == 1
                assert projects[0].name == "My First Project"
                assert projects[0].created_by == TEST_USER.id
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_create_org_when_user_already_has_org_fails(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="Another Org", user=TEST_USER_WITH_ORG)

        match result:
            case Failure(error):
                assert "already belongs to an organization" in str(error)
            case Success(_):
                pytest.fail("Expected failure when user already has an org")

    async def test_create_org_when_name_already_taken_fails(self, db_session: AsyncSession):
        set_session(db_session)

        first = await create_organization(name="Acme Corp", user=TEST_USER)
        assert isinstance(first, Success), f"setup create failed: {first}"

        # Org names are globally unique — a second create with the same name is
        # rejected before insert (TEST_USER.org_id is None, so the user-already-
        # has-org guard does not short-circuit it).
        result = await create_organization(name="Acme Corp", user=TEST_USER)

        match result:
            case Failure(error):
                assert isinstance(error, OrganizationNameTakenError)
                assert "Acme Corp" in str(error)
            case Success(_):
                pytest.fail("Expected failure when org name is already taken")

    async def test_create_org_when_successful_persists_org_in_db(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="Test Org", user=TEST_USER)

        match result:
            case Success(data):
                org_id = data["org_id"]
                assert org_id is not None
                assert len(org_id) > 0
                org = (
                    await db_session.execute(select(OrganizationRecord).where(OrganizationRecord.id == org_id))
                ).scalar_one_or_none()
                assert org is not None
                assert org.name == "Test Org"
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")


class TestCreateOrganizationWorkosErrors:
    """Tests for WorkOS HTTP error handling in create_organization."""

    @patch("app.use_cases.organization.create_organization.get_settings")
    async def test_workos_http_400_error_returns_failure(self, mock_get_settings, db_session: AsyncSession):
        set_session(db_session)

        mock_settings = MagicMock()
        mock_settings.auth_mode = "workos"
        mock_settings.workos_api_key = "test-key"  # pragma: allowlist secret
        mock_settings.workos_api_url = "https://api.workos.com"
        mock_get_settings.return_value = mock_settings

        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.json.return_value = {"message": "Bad request"}
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Bad Request", request=MagicMock(), response=mock_response
        )

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.use_cases.organization.create_organization.httpx.AsyncClient", return_value=mock_client):
            result = await create_organization(name="Bad Org", user=TEST_USER)

        match result:
            case Failure(error):
                assert isinstance(error, ExternalServiceError)
                assert "WorkOS API error: 400" in str(error)
            case Success(_):
                pytest.fail("Expected failure for HTTP 400 error")

    @patch("app.use_cases.organization.create_organization.get_settings")
    async def test_workos_http_500_error_returns_failure(self, mock_get_settings, db_session: AsyncSession):
        set_session(db_session)

        mock_settings = MagicMock()
        mock_settings.auth_mode = "workos"
        mock_settings.workos_api_key = "test-key"  # pragma: allowlist secret
        mock_settings.workos_api_url = "https://api.workos.com"
        mock_get_settings.return_value = mock_settings

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.json.return_value = {"message": "Internal server error"}
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Internal Server Error", request=MagicMock(), response=mock_response
        )

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.use_cases.organization.create_organization.httpx.AsyncClient", return_value=mock_client):
            result = await create_organization(name="Server Error Org", user=TEST_USER)

        match result:
            case Failure(error):
                assert isinstance(error, ExternalServiceError)
                assert "WorkOS API error: 500" in str(error)
            case Success(_):
                pytest.fail("Expected failure for HTTP 500 error")

    @patch("app.use_cases.organization.create_organization.get_settings")
    async def test_workos_network_error_returns_failure(self, mock_get_settings, db_session: AsyncSession):
        set_session(db_session)

        mock_settings = MagicMock()
        mock_settings.auth_mode = "workos"
        mock_settings.workos_api_key = "test-key"  # pragma: allowlist secret
        mock_settings.workos_api_url = "https://api.workos.com"
        mock_get_settings.return_value = mock_settings

        mock_client = AsyncMock()
        mock_client.post.side_effect = httpx.ConnectError("Connection refused")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.use_cases.organization.create_organization.httpx.AsyncClient", return_value=mock_client):
            result = await create_organization(name="Network Error Org", user=TEST_USER)

        match result:
            case Failure(error):
                assert isinstance(error, ExternalServiceError)
                assert "WorkOS API request failed" in str(error)
            case Success(_):
                pytest.fail("Expected failure for network error")
