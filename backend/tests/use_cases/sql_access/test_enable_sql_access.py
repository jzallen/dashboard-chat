"""Tests for enable_sql_access use case."""

from unittest.mock import AsyncMock, patch

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectHasNoDatasets, ProjectNotFound
from app.use_cases.sql_access import enable_sql_access
from app.use_cases.sql_access._infra import MockEnvironmentProvisioner
from app.use_cases.sql_access.exceptions import SqlAccessAlreadyEnabled
from tests.use_cases.sql_access.conftest import TEST_USER
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_EMPTY

# Default settings values used by most tests (match get_settings() defaults)
_DEFAULT_MINIO_ENDPOINT = "localhost:9000"
_INTERNAL_MINIO_ENDPOINT = "minio:9000"

# Patch targets for pg_duckdb manager functions
_PATCH_CREATE_SCHEMA = "app.use_cases.sql_access.enable_sql_access.create_project_schema"
_PATCH_EXECUTE_BOOTSTRAP = "app.use_cases.sql_access.sql_access_service.execute_bootstrap"
_PATCH_GRANT_USAGE = "app.use_cases.sql_access.sql_access_service.grant_schema_usage"


@pytest.fixture(autouse=True)
def pg_manager_mocks():
    """Patch pg_duckdb manager functions for all tests in this module."""
    with (
        patch(_PATCH_CREATE_SCHEMA, new_callable=AsyncMock) as mock_create_schema,
        patch(_PATCH_EXECUTE_BOOTSTRAP, new_callable=AsyncMock) as mock_execute_bootstrap,
        patch(_PATCH_GRANT_USAGE, new_callable=AsyncMock) as mock_grant_usage,
    ):
        yield {
            "create_schema": mock_create_schema,
            "execute_bootstrap": mock_execute_bootstrap,
            "grant_usage": mock_grant_usage,
        }


class TestEnableSqlAccess:
    async def test_enable_when_valid_project_returns_connection_details(
        self,
        pg_manager_mocks,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        assert data["host"] == "localhost"
        assert data["port"] == 6432  # PgBouncer proxy port (first in range)
        assert data["database"] == "dashboard_external"
        assert data["username"].startswith("reader_")
        assert data["password"] is not None
        assert len(data["password"]) == 32
        assert data["schema"].startswith("project_")
        assert data["username"] in data["connection_string"]
        assert data["password"] in data["connection_string"]
        assert data["environment_status"] == "running"

        # Verify provisioner was called
        assert len(mock_provisioner.provision_calls) == 1
        assert mock_provisioner.provision_calls[0][0] == PROJECT_1

        # Verify manager functions received the ProjectEnvironment
        mock_create_schema = pg_manager_mocks["create_schema"]
        mock_create_schema.assert_called_once()
        env_arg = mock_create_schema.call_args[0][0]
        assert env_arg.host == "localhost"
        assert env_arg.port == 15432
        assert mock_create_schema.call_args[0][1] == PROJECT_1

        pg_manager_mocks["execute_bootstrap"].assert_called_once()
        assert pg_manager_mocks["execute_bootstrap"].call_args[0][0] == env_arg

        pg_manager_mocks["grant_usage"].assert_called_once()
        assert pg_manager_mocks["grant_usage"].call_args[0][0] == env_arg

    async def test_enable_when_project_not_found_returns_failure(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        set_session(seeded_db)

        result = await enable_sql_access(project_id="nonexistent", user=TEST_USER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_enable_when_already_enabled_returns_failure(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessAlreadyEnabled)

    async def test_enable_when_project_has_no_datasets_returns_failure(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_no_datasets: AsyncSession,
    ):
        set_session(seeded_db_no_datasets)

        result = await enable_sql_access(project_id=PROJECT_EMPTY, user=TEST_USER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectHasNoDatasets)

    # NOTE: org mismatch test removed — authorization moved to router layer

    async def test_enable_when_previously_disabled_re_enables_record(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db_with_disabled_access: AsyncSession,
    ):
        """Re-enable path: existing disabled record is updated (not created)."""
        set_session(seeded_db_with_disabled_access)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        assert len(data["password"]) == 32
        assert data["host"] == "localhost"
        assert data["port"] == 6432  # PgBouncer proxy port

    async def test_enable_when_bootstrap_fails_deprovisions_environment(
        self,
        pg_manager_mocks,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        """If bootstrap fails after schema creation, the environment should be deprovisioned."""
        pg_manager_mocks["execute_bootstrap"].side_effect = RuntimeError("bootstrap failed")
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Failure)
        pg_manager_mocks["create_schema"].assert_called_once()
        # Verify environment was deprovisioned as compensation
        assert PROJECT_1 in mock_provisioner.deprovision_calls

    async def test_enable_when_successful_stores_md5_hash(
        self,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        """pg_password_hash should be stored as md5 format, not bcrypt."""
        from app.repositories.external_access import ExternalAccessRepository

        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)
        assert isinstance(result, Success)

        # Verify stored hash is md5 format (starts with "md5")
        repo = ExternalAccessRepository(seeded_db)
        record = await repo.get_by_project_id_with_hash(PROJECT_1)
        assert record is not None
        assert record.pg_password_hash.startswith("md5"), f"Expected md5 hash, got: {record.pg_password_hash[:10]}..."

    @patch("app.use_cases.sql_access.sql_access_service.get_settings")
    async def test_enable_when_internal_endpoint_set_uses_it(
        self,
        mock_get_settings,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        """StorageConfig should prefer minio_internal_endpoint when it is non-empty."""
        from app.config import Settings

        mock_get_settings.return_value = Settings(
            minio_internal_endpoint=_INTERNAL_MINIO_ENDPOINT,
        )
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Success)
        storage_config = mock_provisioner.provision_calls[0][1]
        assert storage_config.endpoint == _INTERNAL_MINIO_ENDPOINT

    @patch("app.use_cases.sql_access.sql_access_service.get_settings")
    async def test_enable_when_internal_endpoint_empty_falls_back_to_minio(
        self,
        mock_get_settings,
        mock_provisioner: MockEnvironmentProvisioner,
        seeded_db: AsyncSession,
    ):
        """StorageConfig should fall back to minio_endpoint when minio_internal_endpoint is empty."""
        from app.config import Settings

        mock_get_settings.return_value = Settings(
            minio_internal_endpoint="",
        )
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Success)
        storage_config = mock_provisioner.provision_calls[0][1]
        assert storage_config.endpoint == _DEFAULT_MINIO_ENDPOINT
