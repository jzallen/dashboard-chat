"""Tests for sync_sql_access use case."""

from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access import sync_sql_access
from app.use_cases.sql_access.provisioner import MockEnvironmentProvisioner
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER


class TestSyncSqlAccess:
    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_returns_success_with_timestamp(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db_with_access: AsyncSession
    ):
        set_session(seeded_db_with_access)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["last_synced_at"] is not None

        # Verify manager functions received a ProjectEnvironment with stored host/port
        mock_execute_bootstrap.assert_called_once()
        env_arg = mock_execute_bootstrap.call_args[0][0]
        assert env_arg.host == "localhost"
        assert env_arg.port == 15432

        mock_grant_usage.assert_called_once()
        assert mock_grant_usage.call_args[0][0] == env_arg

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_returns_failure_for_nonexistent_project(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await sync_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_returns_failure_when_not_enabled(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_returns_failure_for_other_org(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db_other_org: AsyncSession
    ):
        set_session(seeded_db_other_org)

        result = await sync_sql_access(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_uses_live_environment_with_internal_host(
        self,
        mock_execute_bootstrap,
        mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        """When the provisioner can reach the container, sync gets internal_host."""
        set_session(seeded_db_with_access)

        # Simulate provisioner knowing about this project
        mock_provisioner._environments[PROJECT_1] = mock_provisioner._default_env

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        env_arg = mock_execute_bootstrap.call_args[0][0]
        # Live environment from MockEnvironmentProvisioner includes full fields
        assert env_arg.environment_id == mock_provisioner._default_env.environment_id

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_falls_back_to_stored_record_when_provisioner_returns_none(
        self,
        mock_execute_bootstrap,
        mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        """When the provisioner can't find the container, sync falls back to stored record."""
        set_session(seeded_db_with_access)

        # Provisioner doesn't know about this project — get_environment returns None
        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        env_arg = mock_execute_bootstrap.call_args[0][0]
        # Falls back to stored values from the external access record
        assert env_arg.host == "localhost"
        assert env_arg.port == 15432

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch(
        "app.use_cases.sql_access.sync_sql_access.execute_bootstrap",
        new_callable=AsyncMock,
        side_effect=RuntimeError("pg_duckdb down"),
    )
    async def test_sync_returns_failure_on_pg_duckdb_error(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db_with_access: AsyncSession
    ):
        """pg_duckdb failure should propagate as a Failure via handle_returns."""
        set_session(seeded_db_with_access)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
