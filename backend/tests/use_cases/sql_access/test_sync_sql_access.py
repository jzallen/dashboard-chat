"""Tests for sync_sql_access use case."""

from returns.result import Failure, Success

from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.sql_access import sync_sql_access
from app.use_cases.sql_access.exceptions import SqlAccessNotEnabled
from tests.uuidv7_fixtures import PROJECT_1


class TestSyncSqlAccess:
    async def test_sync_when_enabled_returns_success(self, seeded_db_with_access, mock_query_engine_provisioner):
        set_session(seeded_db_with_access)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["project_id"] == PROJECT_1
        assert data["last_synced_at"] is not None
        assert len(mock_query_engine_provisioner.sync_calls) == 1

    async def test_sync_when_project_not_found_returns_failure(self, seeded_db):
        set_session(seeded_db)

        result = await sync_sql_access(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_sync_when_not_enabled_returns_failure(self, seeded_db):
        set_session(seeded_db)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_sync_when_provisioner_fails_returns_failure(
        self, seeded_db_with_access, mock_query_engine_provisioner
    ):
        async def failing_sync(*args):
            raise RuntimeError("Engine unreachable")

        mock_query_engine_provisioner.sync_views = failing_sync
        set_session(seeded_db_with_access)

        result = await sync_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Failure)
