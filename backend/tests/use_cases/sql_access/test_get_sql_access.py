"""Tests for get_sql_access use case."""

from returns.result import Failure, Success

from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.sql_access import get_sql_access
from tests.uuidv7_fixtures import PROJECT_1


class TestGetSqlAccess:
    async def test_get_when_enabled_returns_connection_details(self, seeded_db_with_access):
        set_session(seeded_db_with_access)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["enabled"] is True
        assert data["host"] == "query-engine"
        assert data["port"] == 5432
        assert data["database"] == "dashboard_external"
        assert data["username"] == "proxy_project_"
        assert data["schema"] == "project_project_"
        assert data["engine_node_id"] is not None
        assert "datasets" in data
        assert len(data["datasets"]) == 2

    async def test_get_when_no_record_returns_disabled(self, seeded_db):
        set_session(seeded_db)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        assert result.unwrap() == {"project_id": PROJECT_1, "enabled": False}

    async def test_get_when_disabled_returns_disabled(self, seeded_db_with_disabled_access):
        set_session(seeded_db_with_disabled_access)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        assert result.unwrap() == {"project_id": PROJECT_1, "enabled": False}

    async def test_get_when_project_not_found_returns_failure(self, seeded_db):
        set_session(seeded_db)

        result = await get_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)
