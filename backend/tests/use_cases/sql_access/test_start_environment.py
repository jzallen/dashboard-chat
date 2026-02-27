"""Tests for start_environment use case."""

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
from app.use_cases.sql_access.provisioner import MockEnvironmentProvisioner
from app.use_cases.sql_access.start_environment import start_environment
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER


class TestStartEnvironment:
    @patch("app.use_cases.sql_access.start_environment.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.start_environment.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.start_environment.regenerate_credentials", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.start_environment.create_project_schema", new_callable=AsyncMock)
    async def test_start_stopped_environment(
        self,
        mock_create_schema,
        mock_regen_creds,
        mock_execute_bootstrap,
        mock_grant_usage,
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
        mock_create_schema.assert_called_once()
        mock_regen_creds.assert_called_once()
        # The md5 hash argument should start with "md5"
        md5_arg = mock_regen_creds.call_args[0][2]
        assert md5_arg.startswith("md5"), f"Expected md5 hash, got: {md5_arg[:10]}..."

    @patch("app.use_cases.sql_access.start_environment.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.start_environment.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.start_environment.regenerate_credentials", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.start_environment.create_project_schema", new_callable=AsyncMock)
    async def test_start_fails_when_running(
        self,
        mock_create_schema,
        mock_regen_creds,
        mock_execute_bootstrap,
        mock_grant_usage,
        seeded_db_with_access: AsyncSession,
    ):
        """Cannot start an already running environment."""
        set_session(seeded_db_with_access)

        result = await start_environment(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), EnvironmentNotStopped)

    async def test_start_fails_when_not_enabled(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await start_environment(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_start_fails_for_nonexistent_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await start_environment(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_start_fails_for_other_org(self, seeded_db_other_org: AsyncSession):
        set_session(seeded_db_other_org)

        result = await start_environment(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)
