"""Tests for enable_sql_access use case."""

from returns.result import Failure, Success

from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectHasNoDatasets, ProjectNotFound
from app.use_cases.sql_access import enable_sql_access
from app.use_cases.sql_access.exceptions import SqlAccessAlreadyEnabled
from tests.use_cases.sql_access.conftest import TEST_USER
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_EMPTY


class TestEnableSqlAccess:
    async def test_enable_when_valid_project_returns_connection_details(self, seeded_db, mock_query_engine_provisioner):
        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        assert data["host"] == "query-engine"
        assert data["port"] == 5432
        assert data["database"] == "dashboard_external"
        assert data["username"].startswith("proxy_")
        assert data["password"] is not None
        assert len(data["password"]) == 32
        assert data["schema"].startswith("project_")
        assert "engine_node_id" in data
        assert data["username"] in data["connection_string"]

        # Verify provisioner was called
        assert len(mock_query_engine_provisioner.create_calls) == 1
        assert len(mock_query_engine_provisioner.sync_calls) == 1

    async def test_enable_when_project_not_found_returns_failure(self, seeded_db):
        set_session(seeded_db)

        result = await enable_sql_access(project_id="nonexistent", user=TEST_USER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_enable_when_already_enabled_returns_failure(self, seeded_db_with_access):
        set_session(seeded_db_with_access)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessAlreadyEnabled)

    async def test_enable_when_project_has_no_datasets_returns_failure(self, seeded_db_no_datasets):
        set_session(seeded_db_no_datasets)

        result = await enable_sql_access(project_id=PROJECT_EMPTY, user=TEST_USER)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectHasNoDatasets)

    async def test_enable_when_previously_disabled_re_enables_record(
        self, seeded_db_with_disabled_access, mock_query_engine_provisioner
    ):
        set_session(seeded_db_with_disabled_access)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        assert len(data["password"]) == 32

    async def test_enable_stores_md5_hash(self, seeded_db):
        from app.repositories.external_access import ExternalAccessRepository

        set_session(seeded_db)

        result = await enable_sql_access(project_id=PROJECT_1, user=TEST_USER)
        assert isinstance(result, Success)

        repo = ExternalAccessRepository(seeded_db)
        record = await repo.get_by_project_id_with_hash(PROJECT_1)
        assert record is not None
        assert record.pg_password_hash.startswith("md5")
