"""Tests for start_environment use case."""

import pytest
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import (
    EnvironmentNotStopped,
    ProjectNotFound,
    SqlAccessNotEnabled,
)
from app.use_cases.sql_access._infra import MockEnvironmentProvisioner
from app.use_cases.sql_access.start_environment import start_environment
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER

# Patch targets for pg_duckdb manager functions (called from sql_access_service)
_PATCH_CREATE_SCHEMA = "app.use_cases.sql_access.sql_access_service.create_project_schema"
_PATCH_REGEN_CREDS = "app.use_cases.sql_access.sql_access_service.regenerate_credentials"
_PATCH_EXECUTE_BOOTSTRAP = "app.use_cases.sql_access.sql_access_service.execute_bootstrap"
_PATCH_GRANT_USAGE = "app.use_cases.sql_access.sql_access_service.grant_schema_usage"


@pytest.fixture(autouse=True)
def pg_manager_mocks():
    """Patch pg_duckdb manager functions for all tests in this module."""
    with (
        patch(_PATCH_CREATE_SCHEMA, new_callable=AsyncMock) as mock_create_schema,
        patch(_PATCH_REGEN_CREDS, new_callable=AsyncMock) as mock_regen_creds,
        patch(_PATCH_EXECUTE_BOOTSTRAP, new_callable=AsyncMock) as mock_execute_bootstrap,
        patch(_PATCH_GRANT_USAGE, new_callable=AsyncMock) as mock_grant_usage,
    ):
        yield {
            "create_schema": mock_create_schema,
            "regen_creds": mock_regen_creds,
            "execute_bootstrap": mock_execute_bootstrap,
            "grant_usage": mock_grant_usage,
        }


class TestStartEnvironment:
    async def test_start_when_stopped_returns_running_status(
        self,
        pg_manager_mocks,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_stopped_access: AsyncSession,
    ):
        set_session(seeded_db_with_stopped_access)

        result = await start_environment(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["environment_status"] == "running"

        # Verify pg_duckdb was provisioned
        assert len(mock_provisioner.start_environment_calls) == 1

        # Verify role password was set to stored md5 hash after schema creation
        pg_manager_mocks["create_schema"].assert_called_once()
        pg_manager_mocks["regen_creds"].assert_called_once()
        # The md5 hash argument should start with "md5"
        md5_arg = pg_manager_mocks["regen_creds"].call_args[0][2]
        assert md5_arg.startswith("md5"), f"Expected md5 hash, got: {md5_arg[:10]}..."

    async def test_start_when_already_running_returns_failure(
        self,
        seeded_db_with_access: AsyncSession,
    ):
        """Cannot start an already running environment."""
        set_session(seeded_db_with_access)

        result = await start_environment(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), EnvironmentNotStopped)

    async def test_start_when_not_enabled_returns_failure(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await start_environment(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_start_when_project_nonexistent_returns_failure(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await start_environment(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_start_when_different_org_returns_failure(self, seeded_db_other_org: AsyncSession):
        set_session(seeded_db_other_org)

        result = await start_environment(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)
