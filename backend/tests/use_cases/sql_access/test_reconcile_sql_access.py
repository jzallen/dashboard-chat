"""Tests for reconcile_sql_access startup use case."""

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.sql_access.provisioner import MockEnvironmentProvisioner
from app.use_cases.sql_access.reconcile_sql_access import reconcile_sql_access

from tests.uuidv7_fixtures import PROJECT_1


class TestReconcileSqlAccess:

    async def test_no_enabled_records_returns_zero_counts(
        self, mock_provisioner: MockEnvironmentProvisioner, seeded_db: AsyncSession,
    ):
        set_session(seeded_db)

        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["total"] == 0
        assert data["healthy"] == 0
        assert data["degraded"] == 0

    async def test_healthy_environment_counted(
        self, mock_provisioner: MockEnvironmentProvisioner, seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)

        # Simulate that the provisioner knows about this project's environment
        mock_provisioner._environments[PROJECT_1] = mock_provisioner._default_env

        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["total"] == 1
        assert data["healthy"] == 1
        assert data["degraded"] == 0
        assert len(mock_provisioner.health_check_calls) == 1

    async def test_degraded_environment_counted(
        self, mock_provisioner: MockEnvironmentProvisioner, seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)

        # Environment is enabled in DB but provisioner doesn't know about it
        # (health_check returns False because project is not in _environments)

        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["total"] == 1
        assert data["healthy"] == 0
        assert data["degraded"] == 1

    async def test_unhealthy_provisioner_marks_degraded(
        self, mock_provisioner: MockEnvironmentProvisioner, seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)

        mock_provisioner._environments[PROJECT_1] = mock_provisioner._default_env
        mock_provisioner.set_healthy(False)

        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["total"] == 1
        assert data["healthy"] == 0
        assert data["degraded"] == 1

    async def test_disabled_records_not_checked(
        self, mock_provisioner: MockEnvironmentProvisioner, seeded_db_with_disabled_access: AsyncSession,
    ):
        set_session(seeded_db_with_disabled_access)

        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["total"] == 0
        assert len(mock_provisioner.health_check_calls) == 0
