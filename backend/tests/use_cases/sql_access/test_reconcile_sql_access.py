"""Tests for reconcile_sql_access startup use case."""

from unittest.mock import AsyncMock, patch

from returns.result import Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.sql_access._infra import MockEnvironmentProvisioner
from app.use_cases.sql_access.reconcile_sql_access import reconcile_sql_access
from tests.uuidv7_fixtures import PROJECT_1


class TestReconcileSqlAccess:
    async def test_reconcile_when_no_enabled_records_returns_zero_counts(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        set_session(seeded_db)

        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["total"] == 0
        assert data["healthy"] == 0
        assert data["degraded"] == 0

    @patch("app.use_cases.sql_access.reconcile_sql_access.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.reconcile_sql_access.ensure_duckdb_role_configured", new_callable=AsyncMock)
    async def test_reconcile_when_environment_healthy_increments_healthy_count(
        self,
        mock_ensure_role,
        mock_configure_s3,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
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

    @patch("app.use_cases.sql_access.reconcile_sql_access.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.reconcile_sql_access.ensure_duckdb_role_configured", new_callable=AsyncMock)
    async def test_reconcile_when_environment_healthy_reapplies_runtime_config(
        self,
        mock_ensure_role,
        mock_configure_s3,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)

        mock_provisioner._environments[PROJECT_1] = mock_provisioner._default_env

        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        # Runtime config should be re-applied on healthy environments
        mock_ensure_role.assert_awaited_once()
        mock_configure_s3.assert_awaited_once()
        # Verify configure_s3_secrets was called with a StorageConfig
        args = mock_configure_s3.await_args
        assert args is not None
        _env_arg, storage_config_arg = args.args
        assert storage_config_arg.access_key  # Sanity: StorageConfig was passed

    async def test_reconcile_when_environment_not_provisioned_increments_degraded_count(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
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

    @patch("app.use_cases.sql_access.reconcile_sql_access.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.reconcile_sql_access.ensure_duckdb_role_configured", new_callable=AsyncMock)
    async def test_reconcile_when_environment_degraded_skips_runtime_config(
        self,
        mock_ensure_role,
        mock_configure_s3,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)

        # Environment is enabled but provisioner doesn't know about it → degraded
        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["degraded"] == 1
        # Runtime config should NOT be re-applied on degraded environments
        mock_ensure_role.assert_not_awaited()
        mock_configure_s3.assert_not_awaited()

    @patch("app.use_cases.sql_access.reconcile_sql_access.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.reconcile_sql_access.ensure_duckdb_role_configured", new_callable=AsyncMock)
    async def test_reconcile_when_health_check_fails_marks_degraded(
        self,
        mock_ensure_role,
        mock_configure_s3,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
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

    async def test_reconcile_when_record_disabled_skips_health_check(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_disabled_access: AsyncSession,
    ):
        set_session(seeded_db_with_disabled_access)

        result = await reconcile_sql_access()

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["total"] == 0
        assert len(mock_provisioner.health_check_calls) == 0

    @patch("app.use_cases.sql_access.reconcile_sql_access.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.reconcile_sql_access.ensure_duckdb_role_configured", new_callable=AsyncMock)
    async def test_reconcile_when_runtime_config_fails_still_counts_healthy(
        self,
        mock_ensure_role,
        mock_configure_s3,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        """Failures in re-applying runtime config are logged as warnings, not fatal."""
        set_session(seeded_db_with_access)

        mock_provisioner._environments[PROJECT_1] = mock_provisioner._default_env
        mock_ensure_role.side_effect = Exception("GUC apply failed")
        mock_configure_s3.side_effect = Exception("S3 secret failed")

        result = await reconcile_sql_access()

        # Still counts as healthy despite config re-apply failures
        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["total"] == 1
        assert data["healthy"] == 1
        assert data["degraded"] == 0
