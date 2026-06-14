"""Sync processor — background task that polls the outbox for sync events
and executes view DDL against the query engine.
"""

import asyncio
import logging
from datetime import UTC, datetime

from app.config import get_settings
from app.database import async_session
from app.models.dataset import Dataset
from app.repositories import RepositoryContainer, RestrictedSession, set_session
from app.repositories.outbox.events import DatasetRemoved, DatasetSyncRequested, TransformSyncRequested, to_event
from app.use_cases.project._dbt.bootstrap_sql import _build_typed_select, _validate_s3_path
from app.use_cases.project._dbt.naming import resolved_view_name
from app.use_cases.sql_access._infra import get_app_query_engine_provisioner
from app.utils.sql_safety import quote_ident

logger = logging.getLogger(__name__)

# Sync event types that this processor handles
SYNC_EVENT_TYPES = ["DatasetSyncRequested", "TransformSyncRequested", "DatasetRemoved"]

# Retry tracking: record_id -> consecutive failure count
_retry_counts: dict[str, int] = {}
# Track when each record was last attempted (for accurate backoff)
_last_attempts: dict[str, datetime] = {}

MAX_RETRIES = 10
BASE_BACKOFF_SECONDS = 2.0


def _should_retry(record_id: str) -> bool:
    """Check if an event should be retried based on backoff."""
    count = _retry_counts.get(record_id, 0)
    return count < MAX_RETRIES


def _backoff_elapsed(record_id: str) -> bool:
    """Check if enough time has passed since the last attempt."""
    count = _retry_counts.get(record_id, 0)
    if count == 0:
        return True
    backoff = min(BASE_BACKOFF_SECONDS * (2 ** (count - 1)), 300)  # cap at 5 minutes
    last_attempt = _last_attempts.get(record_id)
    if last_attempt is None:
        return True
    elapsed = (datetime.now(UTC) - last_attempt).total_seconds()
    return elapsed >= backoff


def _generate_single_view_sql(
    schema_name: str,
    view_name: str,
    dataset: Dataset,
    bucket: str,
) -> str:
    """Generate CREATE OR REPLACE VIEW SQL for a single dataset."""
    qs = quote_ident(schema_name)
    qv = quote_ident(view_name)
    _validate_s3_path(bucket)
    _validate_s3_path(dataset.storage_path)
    s3_uri = f"s3://{bucket}/{dataset.storage_path}**/*.parquet"
    select_expr = _build_typed_select(dataset, s3_uri)
    return f"CREATE OR REPLACE VIEW {qs}.{qv} AS\n  {select_expr};"


async def _process_dataset_sync(event: DatasetSyncRequested, repositories: RepositoryContainer) -> None:
    """Process a DatasetSyncRequested event — create/update view in engine."""
    settings = get_settings()
    provisioner = get_app_query_engine_provisioner()

    # Get dataset and access record
    dataset_record = await repositories.metadata.get_dataset_record(event.dataset_id, include_transforms=True)
    if not dataset_record:
        logger.warning("Dataset %s not found, skipping sync", event.dataset_id)
        return

    access_record = await repositories.external_access.get_by_project_id(event.project_id)
    if not access_record or not access_record.enabled:
        logger.warning("SQL access not enabled for project %s, skipping sync", event.project_id)
        return

    dataset = Dataset.from_record(dataset_record, include_transforms=True)
    view_name = resolved_view_name(dataset)
    sql = _generate_single_view_sql(access_record.pg_schema, view_name, dataset, settings.storage_bucket)

    # Repoint: when the machine name changed, drop the stale view in the same
    # idempotent DDL batch so the old object does not orphan in the warehouse.
    if event.previous_view_name and event.previous_view_name != view_name:
        qs = quote_ident(access_record.pg_schema)
        q_old = quote_ident(event.previous_view_name)
        sql = f"DROP VIEW IF EXISTS {qs}.{q_old} CASCADE;\n{sql}"

    # Also grant schema usage after view creation
    schema = quote_ident(access_record.pg_schema)
    role = quote_ident(access_record.pg_role)
    full_sql = (
        f"{sql}\nGRANT USAGE ON SCHEMA {schema} TO {role};\nGRANT SELECT ON ALL TABLES IN SCHEMA {schema} TO {role};"
    )

    await provisioner.sync_views(event.engine_node_id, event.project_id, full_sql)

    # Update last_synced_at
    await repositories.external_access.update(event.project_id, {"last_synced_at": datetime.now(UTC)})


async def _process_transform_sync(event: TransformSyncRequested, repositories: RepositoryContainer) -> None:
    """Process a TransformSyncRequested event — update view in engine."""
    # Same logic as dataset sync — regenerate the view with current transforms
    dataset_sync = DatasetSyncRequested(
        project_id=event.project_id,
        dataset_id=event.dataset_id,
        engine_node_id=event.engine_node_id,
    )
    await _process_dataset_sync(dataset_sync, repositories)


async def _process_dataset_removed(event: DatasetRemoved, repositories: RepositoryContainer) -> None:
    """Process a DatasetRemoved event — drop view from engine."""
    access_record = await repositories.external_access.get_by_project_id(event.project_id)
    if not access_record or not access_record.enabled:
        return

    qs = quote_ident(access_record.pg_schema)
    qv = quote_ident(event.view_name)
    drop_sql = f"DROP VIEW IF EXISTS {qs}.{qv} CASCADE;"

    provisioner = get_app_query_engine_provisioner()
    await provisioner.sync_views(event.engine_node_id, event.project_id, drop_sql)


async def process_sync_events() -> int:
    """Poll outbox for sync events and process them. Returns count of processed events."""
    processed_count = 0

    async with async_session() as session:
        set_session(session)
        container = RepositoryContainer(RestrictedSession(session))
        outbox_repo = container.outbox

        records = await outbox_repo.get_unprocessed_sync_events(limit=50)
        if not records:
            return 0

        for record in records:
            if not _should_retry(record.id):
                logger.error("Event %s exceeded max retries, skipping", record.id)
                continue

            if not _backoff_elapsed(record.id):
                continue

            try:
                event = to_event(record.event_type, record.payload)

                if isinstance(event, DatasetSyncRequested):
                    await _process_dataset_sync(event, container)
                elif isinstance(event, TransformSyncRequested):
                    await _process_transform_sync(event, container)
                elif isinstance(event, DatasetRemoved):
                    await _process_dataset_removed(event, container)

                await outbox_repo.mark_processed([record.id])
                _retry_counts.pop(record.id, None)
                _last_attempts.pop(record.id, None)
                processed_count += 1
                logger.debug("Processed sync event %s (%s)", record.id, record.event_type)

            except Exception:
                _retry_counts[record.id] = _retry_counts.get(record.id, 0) + 1
                _last_attempts[record.id] = datetime.now(UTC)
                logger.warning(
                    "Failed to process sync event %s (%s), attempt %d",
                    record.id,
                    record.event_type,
                    _retry_counts[record.id],
                    exc_info=True,
                )

        await session.commit()

    return processed_count


async def run_sync_processor(poll_interval: float = 2.0) -> None:
    """Background task that continuously polls and processes sync events.

    Args:
        poll_interval: Seconds between polls (default 2.0).
    """
    logger.info("Sync processor started (poll interval: %.1fs)", poll_interval)
    while True:
        try:
            processed = await process_sync_events()
            if processed:
                logger.info("Sync processor: processed %d events", processed)
        except Exception:
            logger.error("Sync processor poll cycle failed", exc_info=True)
        await asyncio.sleep(poll_interval)
