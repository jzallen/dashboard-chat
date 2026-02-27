"""Tests for disable_sql_access use case."""

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access import disable_sql_access
from app.use_cases.sql_access._infra import MockEnvironmentProvisioner
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER


class TestDisableSqlAccess:
    async def test_disable_sql_access_when_enabled_returns_success(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)

        result = await disable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        assert result.unwrap() == {"project_id": PROJECT_1, "enabled": False}
        # Verify provisioner deprovisioned the environment
        assert PROJECT_1 in mock_provisioner.deprovision_calls

    async def test_disable_sql_access_when_project_not_found_returns_failure(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        set_session(seeded_db)

        result = await disable_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_disable_sql_access_when_no_record_exists_returns_failure(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        """No external_access record exists at all."""
        set_session(seeded_db)

        result = await disable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_disable_sql_access_when_already_disabled_returns_failure(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_disabled_access: AsyncSession,
    ):
        """Record exists but enabled=False."""
        set_session(seeded_db_with_disabled_access)

        result = await disable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_disable_sql_access_when_other_org_returns_authorization_error(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_other_org: AsyncSession,
    ):
        set_session(seeded_db_other_org)

        result = await disable_sql_access(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)
