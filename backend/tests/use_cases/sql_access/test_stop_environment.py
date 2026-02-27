"""Tests for stop_environment use case."""

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import (
    EnvironmentNotRunning,
    ProjectNotFound,
    SqlAccessNotEnabled,
)
from app.use_cases.sql_access.provisioner import MockEnvironmentProvisioner
from app.use_cases.sql_access.stop_environment import stop_environment
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER


class TestStopEnvironment:
    async def test_stop_running_environment(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)
        # The mock provisioner needs the environment registered
        from app.use_cases.sql_access.provisioner import StorageConfig

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

        result = await stop_environment(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["environment_status"] == "stopped"

        # Verify stop was called
        assert len(mock_provisioner.stop_environment_calls) == 1

    async def test_stop_fails_when_already_stopped(
        self,
        seeded_db_with_stopped_access: AsyncSession,
    ):
        """Cannot stop an already stopped environment."""
        set_session(seeded_db_with_stopped_access)

        result = await stop_environment(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), EnvironmentNotRunning)

    async def test_stop_fails_when_not_enabled(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await stop_environment(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_stop_fails_for_nonexistent_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await stop_environment(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_stop_fails_for_other_org(self, seeded_db_other_org: AsyncSession):
        set_session(seeded_db_other_org)

        result = await stop_environment(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)
