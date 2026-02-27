"""Tests for restart_environment use case."""

from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import (
    EnvironmentNotRunning,
    ProjectNotFound,
    SqlAccessNotEnabled,
)
from app.use_cases.sql_access.provisioner import MockEnvironmentProvisioner, StorageConfig
from app.use_cases.sql_access.restart_environment import restart_environment
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER


class TestRestartEnvironment:
    @patch("app.use_cases.sql_access.restart_environment.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.regenerate_credentials", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.create_project_schema", new_callable=AsyncMock)
    async def test_restart_running_environment(
        self,
        mock_create_schema,
        mock_regen_creds,
        mock_execute_bootstrap,
        mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)
        # Register environment so stop_environment can find it
        await mock_provisioner.provision(
            PROJECT_1,
            StorageConfig(
                endpoint="",
                access_key="",
                secret_key="",
                region="",
                url_style="",
                use_ssl=False,
            ),
        )

        result = await restart_environment(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["environment_status"] == "running"

        # Verify stop + start were called
        assert len(mock_provisioner.stop_environment_calls) == 1
        assert len(mock_provisioner.start_environment_calls) == 1

        # Verify role password was set to stored md5 hash after schema creation
        mock_create_schema.assert_called_once()
        mock_regen_creds.assert_called_once()
        md5_arg = mock_regen_creds.call_args[0][2]
        assert md5_arg.startswith("md5"), f"Expected md5 hash, got: {md5_arg[:10]}..."

    @patch("app.use_cases.sql_access.restart_environment.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.regenerate_credentials", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.create_project_schema", new_callable=AsyncMock)
    async def test_restart_fails_when_stopped(
        self,
        mock_create_schema,
        mock_regen_creds,
        mock_execute_bootstrap,
        mock_grant_usage,
        seeded_db_with_stopped_access: AsyncSession,
    ):
        """Cannot restart a stopped environment; must start it instead."""
        set_session(seeded_db_with_stopped_access)

        result = await restart_environment(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), EnvironmentNotRunning)

    async def test_restart_fails_when_not_enabled(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await restart_environment(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_restart_fails_for_nonexistent_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await restart_environment(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    @patch("app.use_cases.sql_access.restart_environment.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.regenerate_credentials", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.restart_environment.create_project_schema", new_callable=AsyncMock)
    async def test_restart_from_degraded_state(
        self,
        mock_create_schema,
        mock_regen_creds,
        mock_execute_bootstrap,
        mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        """Restart should be allowed from degraded state (not just running)."""
        from app.repositories.external_access import ExternalAccessRepository

        set_session(seeded_db_with_access)

        # Update environment to degraded state
        repo = ExternalAccessRepository(seeded_db_with_access)
        await repo.update(PROJECT_1, {"environment_status": "degraded"})
        await seeded_db_with_access.commit()

        # Register environment so stop_environment can find it
        await mock_provisioner.provision(
            PROJECT_1,
            StorageConfig(
                endpoint="",
                access_key="",
                secret_key="",
                region="",
                url_style="",
                use_ssl=False,
            ),
        )

        result = await restart_environment(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["environment_status"] == "running"

    async def test_restart_fails_for_other_org(self, seeded_db_other_org: AsyncSession):
        set_session(seeded_db_other_org)

        result = await restart_environment(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)
