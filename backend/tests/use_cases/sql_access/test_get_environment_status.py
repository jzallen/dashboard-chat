"""Tests for get_environment_status use case."""

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access.get_environment_status import get_environment_status
from app.use_cases.sql_access.provisioner import (
    MockEnvironmentProvisioner,
    StorageConfig,
)
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER


class TestGetEnvironmentStatus:
    async def test_get_status_when_running_returns_component_details(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)
        # Register environment so detailed_status returns meaningful data
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

        result = await get_environment_status(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["pgduckdb_running"] is True
        assert data["pgbouncer_running"] is True
        assert data["status"] == "running"
        assert data["environment_status"] == "running"
        assert data["is_legacy"] is False

    async def test_get_status_when_stopped_returns_not_running(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_stopped_access: AsyncSession,
    ):
        set_session(seeded_db_with_stopped_access)

        result = await get_environment_status(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["pgduckdb_running"] is False
        assert data["status"] == "stopped"
        assert data["environment_status"] == "stopped"

    async def test_get_status_when_not_enabled_returns_failure(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await get_environment_status(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_get_status_when_project_nonexistent_returns_failure(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await get_environment_status(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_get_status_when_different_org_returns_failure(self, seeded_db_other_org: AsyncSession):
        set_session(seeded_db_other_org)

        result = await get_environment_status(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)
