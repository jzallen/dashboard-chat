"""Tests for enable_sql_access use case."""

from unittest.mock import AsyncMock, patch

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import (
    ProjectHasNoDatasets,
    ProjectNotFound,
    SqlAccessAlreadyEnabled,
)
from app.use_cases.sql_access import enable_sql_access
from app.use_cases.sql_access.provisioner import MockEnvironmentProvisioner

from tests.uuidv7_fixtures import PROJECT_1, PROJECT_EMPTY, PROJECT_OTHER

# Default settings values used by most tests (match get_settings() defaults)
_DEFAULT_MINIO_ENDPOINT = "localhost:9000"
_INTERNAL_MINIO_ENDPOINT = "minio:9000"


class TestEnableSqlAccess:

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_connection_details(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db: AsyncSession,
    ):
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1)

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
        mock_create_schema.assert_called_once()
        env_arg = mock_create_schema.call_args[0][0]
        assert env_arg.host == "localhost"
        assert env_arg.port == 15432
        assert mock_create_schema.call_args[0][1] == PROJECT_1

        mock_execute_bootstrap.assert_called_once()
        assert mock_execute_bootstrap.call_args[0][0] == env_arg

        mock_grant_usage.assert_called_once()
        assert mock_grant_usage.call_args[0][0] == env_arg

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_failure_for_nonexistent_project(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db: AsyncSession,
    ):
        set_session(seeded_db)

        result = await enable_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_failure_when_already_enabled(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db_with_access: AsyncSession,
    ):
        set_session(seeded_db_with_access)

        result = await enable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessAlreadyEnabled)

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_failure_for_project_with_no_datasets(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db_no_datasets: AsyncSession,
    ):
        set_session(seeded_db_no_datasets)

        result = await enable_sql_access(project_id=PROJECT_EMPTY)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectHasNoDatasets)

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_failure_for_other_org(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db_other_org: AsyncSession,
    ):
        set_session(seeded_db_other_org)

        result = await enable_sql_access(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_re_enables_previously_disabled_record(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db_with_disabled_access: AsyncSession,
    ):
        """Re-enable path: existing disabled record is updated (not created)."""
        set_session(seeded_db_with_disabled_access)

        result = await enable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        assert len(data["password"]) == 32
        assert data["host"] == "localhost"
        assert data["port"] == 6432  # PgBouncer proxy port

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock, side_effect=RuntimeError("bootstrap failed"))
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_cleans_up_on_bootstrap_failure(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db: AsyncSession,
    ):
        """If bootstrap fails after schema creation, the environment should be deprovisioned."""
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        mock_create_schema.assert_called_once()
        # Verify environment was deprovisioned as compensation
        assert PROJECT_1 in mock_provisioner.deprovision_calls

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_stores_md5_hash_not_bcrypt(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db: AsyncSession,
    ):
        """pg_password_hash should be stored as md5 format, not bcrypt."""
        from app.repositories.external_access import ExternalAccessRepository

        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1)
        assert isinstance(result, Success)

        # Verify stored hash is md5 format (starts with "md5")
        repo = ExternalAccessRepository(seeded_db)
        record = await repo.get_by_project_id_with_hash(PROJECT_1)
        assert record is not None
        assert record["pg_password_hash"].startswith("md5"), (
            f"Expected md5 hash, got: {record['pg_password_hash'][:10]}..."
        )

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.get_settings")
    async def test_enable_uses_internal_endpoint_when_set(
        self, mock_get_settings, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db: AsyncSession,
    ):
        """StorageConfig should prefer minio_internal_endpoint when it is non-empty."""
        from app.config import Settings

        mock_get_settings.return_value = Settings(
            minio_internal_endpoint=_INTERNAL_MINIO_ENDPOINT,
        )
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        storage_config = mock_provisioner.provision_calls[0][1]
        assert storage_config.endpoint == _INTERNAL_MINIO_ENDPOINT

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.get_settings")
    async def test_enable_falls_back_to_minio_endpoint_when_internal_empty(
        self, mock_get_settings, mock_create_schema, mock_execute_bootstrap, mock_grant_usage,
        mock_provisioner: MockEnvironmentProvisioner, seeded_db: AsyncSession,
    ):
        """StorageConfig should fall back to minio_endpoint when minio_internal_endpoint is empty."""
        from app.config import Settings

        mock_get_settings.return_value = Settings(
            minio_internal_endpoint="",
        )
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        storage_config = mock_provisioner.provision_calls[0][1]
        assert storage_config.endpoint == _DEFAULT_MINIO_ENDPOINT
