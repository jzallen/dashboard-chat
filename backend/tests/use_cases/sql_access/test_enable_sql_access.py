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


class TestEnableSqlAccess:

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_connection_details(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await enable_sql_access(project_id="project-001")

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        assert data["host"] is not None
        assert data["port"] is not None
        assert data["database"] is not None
        assert data["username"].startswith("reader_")
        assert data["password"] is not None
        assert len(data["password"]) == 32
        assert data["schema"].startswith("project_")
        assert data["username"] in data["connection_string"]
        assert data["password"] in data["connection_string"]

        # Verify correct project_id was forwarded to pg_duckdb operations
        mock_create_schema.assert_called_once_with("project-001", data["password"])
        mock_execute_bootstrap.assert_called_once()
        assert mock_execute_bootstrap.call_args[0][0] == "project-001"
        mock_grant_usage.assert_called_once_with("project-001")

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_failure_for_nonexistent_project(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await enable_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_failure_when_already_enabled(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage, seeded_db_with_access: AsyncSession
    ):
        set_session(seeded_db_with_access)

        result = await enable_sql_access(project_id="project-001")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessAlreadyEnabled)

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_failure_for_project_with_no_datasets(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage, seeded_db_no_datasets: AsyncSession
    ):
        set_session(seeded_db_no_datasets)

        result = await enable_sql_access(project_id="project-empty")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectHasNoDatasets)

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_returns_failure_for_other_org(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage, seeded_db_other_org: AsyncSession
    ):
        set_session(seeded_db_other_org)

        result = await enable_sql_access(project_id="project-other")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)

    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_re_enables_previously_disabled_record(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage, seeded_db_with_disabled_access: AsyncSession
    ):
        """Re-enable path: existing disabled record is updated (not created)."""
        set_session(seeded_db_with_disabled_access)

        result = await enable_sql_access(project_id="project-001")

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        assert len(data["password"]) == 32

    @patch("app.use_cases.sql_access.enable_sql_access.drop_project_schema", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.enable_sql_access.execute_bootstrap", new_callable=AsyncMock, side_effect=RuntimeError("bootstrap failed"))
    @patch("app.use_cases.sql_access.enable_sql_access.create_project_schema", new_callable=AsyncMock)
    async def test_enable_cleans_up_on_bootstrap_failure(
        self, mock_create_schema, mock_execute_bootstrap, mock_grant_usage, mock_drop_schema, seeded_db: AsyncSession
    ):
        """If bootstrap fails after schema creation, the schema/role should be cleaned up."""
        set_session(seeded_db)

        result = await enable_sql_access(project_id="project-001")

        assert isinstance(result, Failure)
        mock_create_schema.assert_called_once()
        mock_drop_schema.assert_called_once_with("project-001")
