"""Tests for get_sql_access use case."""

from datetime import UTC, datetime

from returns.result import Failure, Success

from app.repositories import set_session
from app.repositories.outbox import OutboxRecord
from app.use_cases.project._dbt.naming import to_snake_case
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.sql_access import get_sql_access
from tests.uuidv7_fixtures import DATASET_1, DATASET_2, ENGINE_NODE_1, PROJECT_1


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


class TestGetSqlAccessEngineNodeFallback:
    """Pin behaviors around engine-node resolution and the silent fallback to settings.

    These exercise the path that the U3 refactor will route through
    ``_engine.resolve_engine_node_by_id(fallback_to_settings=True)``.
    """

    async def test_get_when_engine_node_id_is_none_falls_back_to_settings(
        self, seeded_db_with_access_no_engine_node
    ):
        """When access_record.engine_node_id is None, host/port/database come from settings."""
        set_session(seeded_db_with_access_no_engine_node)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        # Settings defaults (also happen to match the seeded engine node, which is fine —
        # the point is they come from settings here because engine_node_id is None).
        assert data["host"] == "query-engine"
        assert data["port"] == 5432
        assert data["database"] == "dashboard_external"
        assert data["engine_node_id"] is None

    async def test_get_when_engine_node_id_resolves_to_none_silently_falls_back(
        self, seeded_db_with_access
    ):
        """access_record.engine_node_id is set, but query_engine_node.get_by_id returns None.

        Current impl silently falls back to settings (no error). Pinned because
        the U3 refactor preserves this via fallback_to_settings=True.
        """

        class _FakeQueryEngineNodeRepo:
            def __init__(self):
                self.calls: list[str] = []

            async def get_by_id(self, node_id: str):
                self.calls.append(node_id)
                return None

        set_session(seeded_db_with_access)
        fake_repo = _FakeQueryEngineNodeRepo()

        result = await get_sql_access(
            project_id=PROJECT_1,
            repositories={"query_engine_node_repository": lambda: fake_repo},
        )

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        # Fell back to settings — host/port/database from app.config defaults
        assert data["host"] == "query-engine"
        assert data["port"] == 5432
        assert data["database"] == "dashboard_external"
        # engine_node_id on the response is the access_record's stored id (not the resolved node)
        assert data["engine_node_id"] == ENGINE_NODE_1
        # Confirm we actually attempted the lookup with the access_record's engine_node_id
        assert fake_repo.calls == [ENGINE_NODE_1]


class TestGetSqlAccessUsernamePreference:
    async def test_get_when_proxy_role_unset_returns_pg_role_as_username(
        self, seeded_db_with_access_no_proxy_role
    ):
        """username falls back to pg_role when pg_proxy_role is None."""
        set_session(seeded_db_with_access_no_proxy_role)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["enabled"] is True
        assert data["username"] == "reader_project_"


class TestGetSqlAccessDatasetShape:
    async def test_get_when_enabled_returns_per_dataset_view_name_and_synced_status(
        self, seeded_db_with_access
    ):
        """Each datasets[i] entry has {dataset_id, name, view_name, sync_status}.

        view_name == to_snake_case(name); sync_status defaults to "synced" when
        the dataset id is absent from outbox.get_sync_status_by_dataset results.
        """
        set_session(seeded_db_with_access)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        datasets = data["datasets"]
        assert len(datasets) == 2

        by_id = {ds["dataset_id"]: ds for ds in datasets}
        assert set(by_id.keys()) == {DATASET_1, DATASET_2}

        ds_one = by_id[DATASET_1]
        assert ds_one["name"] == "Dataset One"
        assert ds_one["view_name"] == to_snake_case("Dataset One")
        assert ds_one["view_name"] == "dataset_one"
        assert ds_one["sync_status"] == "synced"

        ds_two = by_id[DATASET_2]
        assert ds_two["name"] == "Dataset Two"
        assert ds_two["view_name"] == "dataset_two"
        assert ds_two["sync_status"] == "synced"

    async def test_get_when_outbox_has_unprocessed_event_returns_pending_status(
        self, seeded_db_with_access
    ):
        """Datasets with a recent unprocessed sync event are reported as 'pending'."""
        seeded_db_with_access.add(
            OutboxRecord(
                id="outbox-pending-1",
                aggregate_id=DATASET_1,
                aggregate_type="dataset",
                event_type="DatasetSyncRequested",
                payload={"dataset_id": DATASET_1},
                created_at=datetime.now(UTC),
                processed=False,
            )
        )
        await seeded_db_with_access.commit()
        set_session(seeded_db_with_access)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        by_id = {ds["dataset_id"]: ds for ds in data["datasets"]}
        assert by_id[DATASET_1]["sync_status"] == "pending"
        # Other datasets without outbox events remain "synced"
        assert by_id[DATASET_2]["sync_status"] == "synced"


class TestGetSqlAccessProjectShortcut:
    async def test_get_when_project_dict_passed_does_not_call_metadata_get_project(
        self, seeded_db_with_access
    ):
        """Passing project=<dict> bypasses ProjectService.fetch_project (no metadata.get_project call).

        Pinned because the U3 refactor routes through _context.load_context which
        preserves this shortcut.
        """
        from app.repositories.metadata import MetadataRepository

        class _RecordingMetadataRepo:
            """Wraps the real metadata repo, recording whether get_project was called."""

            def __init__(self, real_repo: MetadataRepository):
                self._real = real_repo
                self.get_project_calls: list[str] = []

            async def get_project(self, project_id: str):
                self.get_project_calls.append(project_id)
                return await self._real.get_project(project_id)

            def __getattr__(self, name):
                # Delegate everything else to the real repo
                return getattr(self._real, name)

        set_session(seeded_db_with_access)

        # Build the recording repo by wrapping a real one bound to the test session.
        # We use the same RestrictedSession the use case would build internally.
        from app.repositories import RestrictedSession

        real_metadata = MetadataRepository(RestrictedSession(seeded_db_with_access))
        recorder = _RecordingMetadataRepo(real_metadata)

        preloaded_project = {"id": PROJECT_1, "name": "Test Project", "org_id": "any"}

        result = await get_sql_access(
            project_id=PROJECT_1,
            project=preloaded_project,
            repositories={"metadata_repository": lambda: recorder},
        )

        assert isinstance(result, Success)
        assert result.unwrap()["enabled"] is True
        # The shortcut means fetch_project (which calls metadata.get_project) is NOT invoked.
        assert recorder.get_project_calls == []


class TestGetSqlAccessTimestamps:
    async def test_get_when_enabled_returns_record_timestamps(
        self, seeded_db_with_access_pinned_timestamps
    ):
        """last_synced_at and created_at are returned from the access_record (ISO-format strings).

        The ExternalAccessRepository serializes datetimes via .isoformat() before
        the use case ever sees them, so the response carries ISO-format strings.
        """
        set_session(seeded_db_with_access_pinned_timestamps)

        result = await get_sql_access(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        # ISO format produced by repository's .isoformat() call.
        assert data["last_synced_at"] == "2026-02-20T14:00:00"
        assert data["created_at"] == "2026-02-01T10:00:00"
