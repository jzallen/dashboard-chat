"""Tests for sync_sql_access use case."""

import pytest
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access import sync_sql_access
from app.use_cases.sql_access._infra import MockEnvironmentProvisioner
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER

# Patch targets for pg_duckdb manager functions (called from sql_access_service)
_PATCH_EXECUTE_BOOTSTRAP = "app.use_cases.sql_access.sql_access_service.execute_bootstrap"
_PATCH_GRANT_USAGE = "app.use_cases.sql_access.sql_access_service.grant_schema_usage"


@pytest.fixture(autouse=True)
def pg_manager_mocks():
    """Patch pg_duckdb manager functions for all tests in this module."""
    with (
        patch(_PATCH_EXECUTE_BOOTSTRAP, new_callable=AsyncMock) as mock_execute_bootstrap,
        patch(_PATCH_GRANT_USAGE, new_callable=AsyncMock) as mock_grant_usage,
    ):
        yield {
            "execute_bootstrap": mock_execute_bootstrap,
            "grant_usage": mock_grant_usage,
        }


class TestSyncSqlAccess:
    async def test_sync_when_enabled_returns_success_with_timestamp(
        self, pg_manager_mocks, seeded_db_with_access: AsyncSession
    ):
        set_session(seeded_db_with_access)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["last_synced_at"] is not None

        # Verify manager functions received a ProjectEnvironment with stored host/port
        pg_manager_mocks["execute_bootstrap"].assert_called_once()
        env_arg = pg_manager_mocks["execute_bootstrap"].call_args[0][0]
        assert env_arg.host == "localhost"
        assert env_arg.port == 15432

        pg_manager_mocks["grant_usage"].assert_called_once()
        assert pg_manager_mocks["grant_usage"].call_args[0][0] == env_arg

    async def test_sync_when_project_not_found_returns_failure(
        self, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await sync_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_sync_when_not_enabled_returns_failure(
        self, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_sync_when_other_org_returns_authorization_error(
        self, seeded_db_other_org: AsyncSession
    ):
        set_session(seeded_db_other_org)

        result = await sync_sql_access(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)

    async def test_sync_when_provisioner_has_environment_uses_live_env(
        self,
        pg_manager_mocks,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        """When the provisioner can reach the container, sync gets internal_host."""
        set_session(seeded_db_with_access)

        # Simulate provisioner knowing about this project
        mock_provisioner._environments[PROJECT_1] = mock_provisioner._default_env

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        env_arg = pg_manager_mocks["execute_bootstrap"].call_args[0][0]
        # Live environment from MockEnvironmentProvisioner includes full fields
        assert env_arg.environment_id == mock_provisioner._default_env.environment_id

    async def test_sync_when_provisioner_returns_none_falls_back_to_stored_record(
        self,
        pg_manager_mocks,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        """When the provisioner can't find the container, sync falls back to stored record."""
        set_session(seeded_db_with_access)

        # Provisioner doesn't know about this project — get_environment returns None
        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        env_arg = pg_manager_mocks["execute_bootstrap"].call_args[0][0]
        # Falls back to stored values from the external access record
        assert env_arg.host == "localhost"
        assert env_arg.port == 15432

    async def test_sync_when_pg_duckdb_fails_returns_failure(
        self, pg_manager_mocks, seeded_db_with_access: AsyncSession
    ):
        """pg_duckdb failure should propagate as a Failure via handle_returns."""
        pg_manager_mocks["execute_bootstrap"].side_effect = RuntimeError("pg_duckdb down")
        set_session(seeded_db_with_access)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
