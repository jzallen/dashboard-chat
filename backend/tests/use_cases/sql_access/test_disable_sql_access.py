"""Tests for disable_sql_access use case."""

from unittest.mock import AsyncMock, patch

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access import disable_sql_access


class TestDisableSqlAccess:

    @patch("app.use_cases.sql_access.disable_sql_access.drop_project_schema", new_callable=AsyncMock)
    async def test_disable_returns_success(
        self, mock_drop_schema, seeded_db_with_access: AsyncSession
    ):
        set_session(seeded_db_with_access)

        result = await disable_sql_access(project_id="project-001")

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == "project-001"
        assert data["enabled"] is False
        mock_drop_schema.assert_called_once_with("project-001")

    @patch("app.use_cases.sql_access.disable_sql_access.drop_project_schema", new_callable=AsyncMock)
    async def test_disable_returns_failure_for_nonexistent_project(
        self, mock_drop_schema, seeded_db: AsyncSession
    ):
        set_session(seeded_db)

        result = await disable_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    @patch("app.use_cases.sql_access.disable_sql_access.drop_project_schema", new_callable=AsyncMock)
    async def test_disable_returns_failure_when_not_enabled(
        self, mock_drop_schema, seeded_db: AsyncSession
    ):
        """No external_access record exists at all."""
        set_session(seeded_db)

        result = await disable_sql_access(project_id="project-001")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    @patch("app.use_cases.sql_access.disable_sql_access.drop_project_schema", new_callable=AsyncMock)
    async def test_disable_returns_failure_when_already_disabled(
        self, mock_drop_schema, seeded_db_with_disabled_access: AsyncSession
    ):
        """Record exists but enabled=False."""
        set_session(seeded_db_with_disabled_access)

        result = await disable_sql_access(project_id="project-001")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    @patch("app.use_cases.sql_access.disable_sql_access.drop_project_schema", new_callable=AsyncMock)
    async def test_disable_returns_failure_for_other_org(
        self, mock_drop_schema, seeded_db_other_org: AsyncSession
    ):
        set_session(seeded_db_other_org)

        result = await disable_sql_access(project_id="project-other")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)
