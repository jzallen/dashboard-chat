"""Tests for regenerate_sql_credentials use case."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import (
    CredentialCooldown,
    ProjectNotFound,
    SqlAccessNotEnabled,
)
from app.use_cases.sql_access import regenerate_sql_credentials
from tests.use_cases.sql_access.conftest import MOCK_ENV_HOST, MOCK_ENV_PORT

from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER


class TestRegenerateSqlCredentials:

    @patch("app.use_cases.sql_access.regenerate_sql_credentials.get_settings")
    @patch("app.use_cases.sql_access.regenerate_sql_credentials.regenerate_credentials", new_callable=AsyncMock)
    async def test_regenerate_returns_new_credentials(
        self, mock_regenerate, mock_get_settings, seeded_db_with_access: AsyncSession
    ):
        from app.config import Settings
        mock_get_settings.return_value = Settings(credential_regen_cooldown_seconds=0)
        set_session(seeded_db_with_access)

        result = await regenerate_sql_credentials(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["password"] is not None
        assert len(data["password"]) == 32
        assert data["host"] == MOCK_ENV_HOST
        assert data["port"] == MOCK_ENV_PORT
        assert data["database"] is not None
        assert data["username"] is not None
        assert "connection_string" in data
        # Verify correct args passed to pg_duckdb (env, project_id, password)
        mock_regenerate.assert_called_once()
        env_arg = mock_regenerate.call_args[0][0]
        assert env_arg.host == MOCK_ENV_HOST
        assert mock_regenerate.call_args[0][1] == PROJECT_1
        assert mock_regenerate.call_args[0][2] == data["password"]

    @patch("app.use_cases.sql_access.regenerate_sql_credentials.regenerate_credentials", new_callable=AsyncMock)
    async def test_regenerate_returns_failure_for_nonexistent_project(
        self, mock_regenerate, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await regenerate_sql_credentials(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    @patch("app.use_cases.sql_access.regenerate_sql_credentials.regenerate_credentials", new_callable=AsyncMock)
    async def test_regenerate_returns_failure_when_not_enabled(
        self, mock_regenerate, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await regenerate_sql_credentials(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    @patch("app.use_cases.sql_access.regenerate_sql_credentials.regenerate_credentials", new_callable=AsyncMock)
    async def test_regenerate_returns_failure_for_other_org(
        self, mock_regenerate, seeded_db_other_org: AsyncSession
    ):
        set_session(seeded_db_other_org)

        result = await regenerate_sql_credentials(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)

    @patch("app.use_cases.sql_access.regenerate_sql_credentials.get_settings")
    @patch("app.use_cases.sql_access.regenerate_sql_credentials.regenerate_credentials", new_callable=AsyncMock, side_effect=RuntimeError("pg_duckdb down"))
    async def test_regenerate_returns_failure_on_pg_duckdb_error(
        self, mock_regenerate, mock_get_settings, seeded_db_with_access: AsyncSession
    ):
        """pg_duckdb failure should propagate as a Failure via handle_returns."""
        from app.config import Settings
        mock_get_settings.return_value = Settings(credential_regen_cooldown_seconds=0)
        set_session(seeded_db_with_access)

        result = await regenerate_sql_credentials(project_id=PROJECT_1)

        assert isinstance(result, Failure)

    @patch("app.use_cases.sql_access.regenerate_sql_credentials.regenerate_credentials", new_callable=AsyncMock)
    async def test_regenerate_rate_limited_within_cooldown(
        self, mock_regenerate, seeded_db_with_access: AsyncSession
    ):
        """Should reject regeneration when updated_at is within cooldown period."""
        set_session(seeded_db_with_access)

        # Default cooldown is 60 seconds, and the record was just created
        result = await regenerate_sql_credentials(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), CredentialCooldown)
        mock_regenerate.assert_not_called()
