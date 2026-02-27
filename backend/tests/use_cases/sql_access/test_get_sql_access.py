"""Tests for get_sql_access use case."""

from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.exceptions import AuthorizationError
from app.repositories import set_session
from app.use_cases.exceptions import ProjectNotFound
from app.use_cases.sql_access import get_sql_access
from tests.use_cases.sql_access.conftest import MOCK_ENV_HOST, MOCK_ENV_PORT
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_OTHER


class TestGetSqlAccess:
    async def test_get_sql_access_when_enabled_returns_connection_details(self, seeded_db_with_access: AsyncSession):
        set_session(seeded_db_with_access)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data.keys() == {
            "project_id",
            "enabled",
            "host",
            "port",
            "database",
            "username",
            "schema",
            "environment_status",
            "status_message",
            "is_legacy",
            "last_synced_at",
            "created_at",
        }
        assert data["project_id"] == PROJECT_1
        assert data["enabled"] is True
        assert data["host"] == MOCK_ENV_HOST
        assert data["port"] == MOCK_ENV_PORT
        assert data["database"] is not None
        assert data["username"] is not None
        assert data["schema"] is not None
        assert data["environment_status"] == "running"
        assert data["is_legacy"] is False

    async def test_get_sql_access_when_no_record_exists_returns_disabled(self, seeded_db: AsyncSession):
        """No external_access record for this project — enabled=False."""
        set_session(seeded_db)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        assert result.unwrap() == {"project_id": PROJECT_1, "enabled": False}

    async def test_get_sql_access_when_disabled_returns_disabled(self, seeded_db_with_disabled_access: AsyncSession):
        """Record exists but enabled=False — distinct code path from no-record."""
        set_session(seeded_db_with_disabled_access)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        assert result.unwrap() == {"project_id": PROJECT_1, "enabled": False}

    async def test_get_sql_access_when_project_not_found_returns_failure(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await get_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_get_sql_access_when_other_org_returns_authorization_error(self, seeded_db_other_org: AsyncSession):
        set_session(seeded_db_other_org)

        result = await get_sql_access(project_id=PROJECT_OTHER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), AuthorizationError)
