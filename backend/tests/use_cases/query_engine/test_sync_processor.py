"""Tests for the sync processor background task."""

from unittest.mock import AsyncMock, patch

from app.repositories import RepositoryContainer, RestrictedSession, set_session
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.repositories.metadata.external_access_record import ExternalAccessRecord
from app.repositories.metadata.query_engine_node_record import QueryEngineNodeRecord
from app.use_cases.query_engine.sync_processor import (
    _retry_counts,
    process_sync_events,
)
from app.use_cases.sql_access._infra import MockQueryEngineProvisioner, set_app_query_engine_provisioner
from tests.uuidv7_fixtures import DATASET_1, ORG_1, PROJECT_1

ENGINE_NODE_ID = "019515a0-8001-7000-8000-000000000081"


async def _seed(db_session):
    """Seed project, dataset, engine node, and external access record."""
    # Parent records first
    db_session.add(
        QueryEngineNodeRecord(
            id=ENGINE_NODE_ID,
            org_id=ORG_1,
            name="test-engine",
            host="localhost",
            port=5432,
            database="dashboard_external",
            admin_user="admin",
            admin_password_encrypted="secret",
            status="active",
        )
    )
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    await db_session.flush()

    # Child records
    db_session.add(
        DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="Test Dataset",
            schema_config={"fields": {"col1": {"type": "text"}}},
        )
    )
    db_session.add(
        ExternalAccessRecord(
            project_id=PROJECT_1,
            org_id=ORG_1,
            engine_node_id=ENGINE_NODE_ID,
            pg_schema=f"project_{PROJECT_1[:8]}",
            pg_role=f"reader_{PROJECT_1[:8]}",
            pg_proxy_role=f"proxy_{PROJECT_1[:8]}",
            pg_password_hash="md5fake",
            enabled=True,
        )
    )
    await db_session.commit()


async def test_process_dataset_sync_event(db_session):
    """Should process a DatasetSyncRequested event and call provisioner.sync_views."""
    await _seed(db_session)
    set_session(db_session)

    mock_provisioner = MockQueryEngineProvisioner()
    set_app_query_engine_provisioner(mock_provisioner)

    # Submit a sync event
    container = RepositoryContainer(RestrictedSession(db_session))
    await container.outbox.submit_dataset_sync_event(
        project_id=PROJECT_1,
        dataset_id=DATASET_1,
        engine_node_id=ENGINE_NODE_ID,
    )
    await db_session.commit()

    # Process
    with patch("app.use_cases.query_engine.sync_processor.async_session") as mock_session_ctx:
        mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)
        processed = await process_sync_events()

    assert processed == 1
    assert len(mock_provisioner.sync_calls) == 1
    assert mock_provisioner.sync_calls[0][0] == ENGINE_NODE_ID


async def test_process_dataset_sync_uses_model_name_for_view(db_session):
    """When a dataset carries a model_name, the synced view binds to it
    (the warehouse machine name), not the filename-derived snake name."""
    await _seed(db_session)
    set_session(db_session)

    # Give the dataset a user-set machine name.
    container = RepositoryContainer(RestrictedSession(db_session))
    await container.metadata.update_dataset(DATASET_1, model_name="stg_warm_leads")
    await db_session.commit()

    mock_provisioner = MockQueryEngineProvisioner()
    set_app_query_engine_provisioner(mock_provisioner)

    await container.outbox.submit_dataset_sync_event(
        project_id=PROJECT_1,
        dataset_id=DATASET_1,
        engine_node_id=ENGINE_NODE_ID,
    )
    await db_session.commit()

    with patch("app.use_cases.query_engine.sync_processor.async_session") as mock_session_ctx:
        mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)
        await process_sync_events()

    sql = mock_provisioner.sync_calls[0][2]
    assert "CREATE OR REPLACE VIEW" in sql
    assert '"stg_warm_leads"' in sql
    # No DROP when there is no previous view name.
    assert "DROP VIEW" not in sql


async def test_process_dataset_sync_drops_old_view_on_repoint(db_session):
    """A machine-name repoint carries previous_view_name; the sync drops the
    stale view (no orphan) then creates the new one in one DDL batch."""
    await _seed(db_session)
    set_session(db_session)

    container = RepositoryContainer(RestrictedSession(db_session))
    await container.metadata.update_dataset(DATASET_1, model_name="stg_warm_leads")
    await db_session.commit()

    mock_provisioner = MockQueryEngineProvisioner()
    set_app_query_engine_provisioner(mock_provisioner)

    await container.outbox.submit_dataset_sync_event(
        project_id=PROJECT_1,
        dataset_id=DATASET_1,
        engine_node_id=ENGINE_NODE_ID,
        previous_view_name="test_dataset",
    )
    await db_session.commit()

    with patch("app.use_cases.query_engine.sync_processor.async_session") as mock_session_ctx:
        mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)
        await process_sync_events()

    sql = mock_provisioner.sync_calls[0][2]
    assert "DROP VIEW IF EXISTS" in sql
    assert '"test_dataset"' in sql
    assert "CREATE OR REPLACE VIEW" in sql
    assert '"stg_warm_leads"' in sql
    # Drop precedes create so the rename is atomic within the batch.
    assert sql.index("DROP VIEW") < sql.index("CREATE OR REPLACE VIEW")


async def test_process_dataset_removed_event(db_session):
    """Should process a DatasetRemoved event and call provisioner with DROP VIEW."""
    await _seed(db_session)
    set_session(db_session)

    mock_provisioner = MockQueryEngineProvisioner()
    set_app_query_engine_provisioner(mock_provisioner)

    container = RepositoryContainer(RestrictedSession(db_session))
    await container.outbox.submit_dataset_removed_event(
        project_id=PROJECT_1,
        dataset_id=DATASET_1,
        engine_node_id=ENGINE_NODE_ID,
        view_name="test_dataset",
    )
    await db_session.commit()

    with patch("app.use_cases.query_engine.sync_processor.async_session") as mock_session_ctx:
        mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)
        processed = await process_sync_events()

    assert processed == 1
    assert len(mock_provisioner.sync_calls) == 1
    # The SQL should contain DROP VIEW
    sql = mock_provisioner.sync_calls[0][2]
    assert "DROP VIEW" in sql


async def test_no_events_returns_zero(db_session):
    """Should return 0 when there are no unprocessed sync events."""
    set_session(db_session)

    with patch("app.use_cases.query_engine.sync_processor.async_session") as mock_session_ctx:
        mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)
        processed = await process_sync_events()

    assert processed == 0


async def test_failed_event_increments_retry_count(db_session):
    """Should increment retry count on failure and not mark as processed."""
    await _seed(db_session)
    set_session(db_session)

    # Set up a provisioner that fails
    mock_provisioner = MockQueryEngineProvisioner()
    mock_provisioner.set_healthy(False)
    set_app_query_engine_provisioner(mock_provisioner)

    # Make sync_views raise
    async def failing_sync(*args):
        raise RuntimeError("Engine unreachable")

    mock_provisioner.sync_views = failing_sync

    container = RepositoryContainer(RestrictedSession(db_session))
    record = await container.outbox.submit_dataset_sync_event(
        project_id=PROJECT_1,
        dataset_id=DATASET_1,
        engine_node_id=ENGINE_NODE_ID,
    )
    await db_session.commit()

    _retry_counts.clear()

    with patch("app.use_cases.query_engine.sync_processor.async_session") as mock_session_ctx:
        mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=db_session)
        mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)
        processed = await process_sync_events()

    assert processed == 0
    assert record.id in _retry_counts
    assert _retry_counts[record.id] == 1


async def test_sync_status_derivation(db_session):
    """Should derive per-dataset sync status from outbox state."""
    await _seed(db_session)
    set_session(db_session)

    container = RepositoryContainer(RestrictedSession(db_session))

    # No events — should be synced
    statuses = await container.outbox.get_sync_status_by_dataset([DATASET_1])
    assert statuses[DATASET_1] == "synced"

    # Add an unprocessed event — should be pending
    await container.outbox.submit_dataset_sync_event(
        project_id=PROJECT_1,
        dataset_id=DATASET_1,
        engine_node_id=ENGINE_NODE_ID,
    )
    await db_session.flush()

    statuses = await container.outbox.get_sync_status_by_dataset([DATASET_1])
    assert statuses[DATASET_1] == "pending"
