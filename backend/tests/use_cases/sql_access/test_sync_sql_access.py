"""Tests for sync_sql_access use case."""

from unittest.mock import AsyncMock, patch

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access import sync_sql_access


class TestSyncSqlAccess:

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_returns_success_with_timestamp(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db_with_access: AsyncSession
    ):
        set_session(seeded_db_with_access)

        result = await sync_sql_access(project_id="project-001")

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == "project-001"
        assert data["last_synced_at"] is not None
        mock_execute_bootstrap.assert_called_once()
        assert mock_execute_bootstrap.call_args[0][0] == "project-001"
        mock_grant_usage.assert_called_once_with("project-001")

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_returns_failure_for_nonexistent_project(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await sync_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_returns_failure_when_not_enabled(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await sync_sql_access(project_id="project-001")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock)
    async def test_sync_returns_failure_for_other_org(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db_other_org: AsyncSession
    ):
        set_session(seeded_db_other_org)

        result = await sync_sql_access(project_id="project-other")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)

    @patch("app.use_cases.sql_access.sync_sql_access.grant_schema_usage", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access.sync_sql_access.execute_bootstrap", new_callable=AsyncMock, side_effect=RuntimeError("pg_duckdb down"))
    async def test_sync_returns_failure_on_pg_duckdb_error(
        self, mock_execute_bootstrap, mock_grant_usage, seeded_db_with_access: AsyncSession
    ):
        """pg_duckdb failure should propagate as a Failure via handle_returns."""
        set_session(seeded_db_with_access)

        result = await sync_sql_access(project_id="project-001")

        assert isinstance(result, Failure)
