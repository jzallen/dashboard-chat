"""Tests for disable_sql_access use case."""

from returns.result import Failure, Success

from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.sql_access import disable_sql_access
from app.use_cases.sql_access.exceptions import SqlAccessNotEnabled
from tests.uuidv7_fixtures import PROJECT_1


class TestDisableSqlAccess:
    async def test_disable_when_enabled_returns_success(self, seeded_db_with_access, mock_query_engine_provisioner):
        set_session(seeded_db_with_access)

        result = await disable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        assert result.unwrap() == {"project_id": PROJECT_1, "enabled": False}
        # Verify provisioner dropped project access
        assert len(mock_query_engine_provisioner.drop_calls) == 1

    async def test_disable_when_project_not_found_returns_failure(self, seeded_db):
        set_session(seeded_db)

        result = await disable_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_disable_when_no_record_exists_returns_failure(self, seeded_db):
        set_session(seeded_db)

        result = await disable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_disable_when_already_disabled_returns_failure(self, seeded_db_with_disabled_access):
        set_session(seeded_db_with_disabled_access)

        result = await disable_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)
