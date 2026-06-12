"""OutboxRepository - Event storage for the outbox pattern.

Provides event sourcing capabilities:
- Append domain events to the outbox
- Query events for state reconstruction (by use cases)
- Support for future event publishing
"""

from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, datetime
from functools import wraps
from typing import TYPE_CHECKING, ParamSpec, TypeVar

from sqlalchemy import select, update
from sqlalchemy.exc import NoResultFound, SQLAlchemyError

from ..exceptions import OutboxRepositoryError
from .events import (
    DatasetRemoved,
    DatasetSyncRequested,
    OutboxEvent,
    ProjectCreated,
    SourceCreated,
    TransformsCreated,
    TransformsUpdated,
    TransformSyncRequested,
    UploadFileReceived,
    UploadRecorded,
    to_event,
)
from .outbox_record import OutboxRecord

if TYPE_CHECKING:
    from app.repositories import RestrictedSession

P = ParamSpec("P")
R = TypeVar("R")


def handle_repository_exceptions(func: Callable[P, R]) -> Callable[P, R]:
    """Decorator that wraps SQLAlchemy exceptions for repository methods.

    - NoResultFound → returns None
    - Other SQLAlchemyError → raises OutboxRepositoryError
    """

    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return await func(*args, **kwargs)
        except NoResultFound:
            return None
        except SQLAlchemyError as e:
            raise OutboxRepositoryError(str(e)) from e

    return wrapper


class OutboxRepository:
    """Repository for outbox event storage.

    Provides event sourcing primitives:
    - Append events with automatic serialization
    - Fetch events for state reconstruction
    - Mark events as processed for publishing

    Note: State reconstruction logic belongs in use cases, not here.
    """

    def __init__(self, session: "RestrictedSession") -> None:
        """Initialize with restricted session.

        Args:
            session: RestrictedSession (only exposes execute/add/flush/refresh/delete)
        """
        self._session = session

    @handle_repository_exceptions
    async def submit_file_received_event(
        self,
        project_id: str,
        file_name: str,
        file_size: int,
        dataset_id: str | None = None,
        plugin_name: str | None = None,
    ) -> OutboxEvent:
        event = UploadFileReceived(
            project_id=project_id,
            raw_storage_path=f"uploads/{project_id}/{file_name}",
            original_filename=file_name,
            file_size=file_size,
            dataset_id=dataset_id,
            plugin_name=plugin_name,
        )
        return await self._append_event(
            aggregate_type="project",
            aggregate_id=project_id,
            event=event,
        )

    @handle_repository_exceptions
    async def submit_transforms_created_event(
        self,
        dataset_id: str,
        transforms: list[dict],
    ) -> OutboxRecord:
        event = TransformsCreated(dataset_id=dataset_id, transforms=transforms)
        return await self._append_event(
            aggregate_type="dataset",
            aggregate_id=dataset_id,
            event=event,
        )

    @handle_repository_exceptions
    async def submit_transforms_updated_event(
        self,
        dataset_id: str,
        changes: list[dict],
    ) -> OutboxRecord:
        event = TransformsUpdated(dataset_id=dataset_id, changes=changes)
        return await self._append_event(
            aggregate_type="dataset",
            aggregate_id=dataset_id,
            event=event,
        )

    @handle_repository_exceptions
    async def submit_project_created_event(
        self,
        project_id: str,
        org_id: str,
        created_by: str,
    ) -> OutboxRecord:
        event = ProjectCreated(
            project_id=project_id,
            org_id=org_id,
            created_by=created_by,
        )
        return await self._append_event(
            aggregate_type="project",
            aggregate_id=project_id,
            event=event,
        )

    @handle_repository_exceptions
    async def submit_source_created_event(
        self,
        source_id: str,
        project_id: str,
        created_by: str | None = None,
    ) -> OutboxRecord:
        event = SourceCreated(
            source_id=source_id,
            project_id=project_id,
            created_by=created_by,
        )
        return await self._append_event(
            aggregate_type="source",
            aggregate_id=source_id,
            event=event,
        )

    @handle_repository_exceptions
    async def submit_upload_recorded_event(
        self,
        source_id: str,
        project_id: str,
        upload_id: str,
        storage_key: str,
        original_filename: str,
        file_size: int,
        content_type: str,
        status: str = "pending",
    ) -> OutboxRecord:
        """Record an upload (presigned PUT minted) for later UI-triggered ingestion.

        The aggregate is the ``upload`` so the process request can fetch the
        pending event by (source_id, upload_id) without colliding with the
        synchronous ``UploadFileReceived`` path.
        """
        event = UploadRecorded(
            source_id=source_id,
            project_id=project_id,
            upload_id=upload_id,
            storage_key=storage_key,
            original_filename=original_filename,
            file_size=file_size,
            content_type=content_type,
            status=status,
        )
        return await self._append_event(
            aggregate_type="upload",
            aggregate_id=upload_id,
            event=event,
        )

    @handle_repository_exceptions
    async def submit_dataset_sync_event(
        self,
        project_id: str,
        dataset_id: str,
        engine_node_id: str,
    ) -> OutboxRecord:
        event = DatasetSyncRequested(
            project_id=project_id,
            dataset_id=dataset_id,
            engine_node_id=engine_node_id,
        )
        return await self._append_event(
            aggregate_type="dataset",
            aggregate_id=dataset_id,
            event=event,
        )

    @handle_repository_exceptions
    async def submit_transform_sync_event(
        self,
        project_id: str,
        dataset_id: str,
        engine_node_id: str,
    ) -> OutboxRecord:
        event = TransformSyncRequested(
            project_id=project_id,
            dataset_id=dataset_id,
            engine_node_id=engine_node_id,
        )
        return await self._append_event(
            aggregate_type="dataset",
            aggregate_id=dataset_id,
            event=event,
        )

    @handle_repository_exceptions
    async def submit_dataset_removed_event(
        self,
        project_id: str,
        dataset_id: str,
        engine_node_id: str,
        view_name: str,
    ) -> OutboxRecord:
        event = DatasetRemoved(
            project_id=project_id,
            dataset_id=dataset_id,
            engine_node_id=engine_node_id,
            view_name=view_name,
        )
        return await self._append_event(
            aggregate_type="dataset",
            aggregate_id=dataset_id,
            event=event,
        )

    @handle_repository_exceptions
    async def get_pending_event(
        self,
        aggregate_type: str,
        aggregate_id: str,
        event_type: str,
    ) -> OutboxRecord | None:
        """Fetch the most recent unprocessed event matching the criteria.

        Args:
            aggregate_type: Type of aggregate (e.g., "project")
            aggregate_id: ID of the aggregate instance
            event_type: Event class name (e.g., "ProjectCreated")

        Returns:
            OutboxRecord if found, None otherwise
        """
        result = await self._session.execute(
            select(OutboxRecord)
            .where(
                OutboxRecord.aggregate_type == aggregate_type,
                OutboxRecord.aggregate_id == aggregate_id,
                OutboxRecord.event_type == event_type,
                OutboxRecord.processed == False,
            )
            .order_by(OutboxRecord.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    @handle_repository_exceptions
    async def get_unprocessed(
        self,
        limit: int = 100,
        event_types: list[str] | None = None,
    ) -> list[OutboxRecord]:
        """Fetch unprocessed events ordered by creation time.

        Args:
            limit: Maximum number of records to return.
            event_types: Optional filter to specific event types.
        """
        query = (
            select(OutboxRecord)
            .where(OutboxRecord.processed == False)
            .order_by(OutboxRecord.created_at.asc())
            .limit(limit)
        )
        if event_types:
            query = query.where(OutboxRecord.event_type.in_(event_types))
        result = await self._session.execute(query)
        return list(result.scalars().all())

    @handle_repository_exceptions
    async def get_unprocessed_sync_events(
        self,
        limit: int = 100,
    ) -> list[OutboxRecord]:
        """Fetch unprocessed sync events (DatasetSyncRequested, TransformSyncRequested, DatasetRemoved)."""
        return await self.get_unprocessed(
            limit=limit,
            event_types=["DatasetSyncRequested", "TransformSyncRequested", "DatasetRemoved"],
        )

    @handle_repository_exceptions
    async def get_sync_status_by_dataset(
        self,
        dataset_ids: list[str],
    ) -> dict[str, str]:
        """Derive per-dataset sync status from outbox state.

        Returns a dict of dataset_id -> status ("synced" | "pending" | "error").
        Datasets with no unprocessed sync events are "synced".
        Datasets with unprocessed sync events less than 60s old are "pending".
        Datasets with unprocessed sync events older than 60s are "error" (likely stuck).
        """
        if not dataset_ids:
            return {}

        sync_types = ["DatasetSyncRequested", "TransformSyncRequested", "DatasetRemoved"]
        result = await self._session.execute(
            select(
                OutboxRecord.aggregate_id,
                OutboxRecord.created_at,
            ).where(
                OutboxRecord.aggregate_id.in_(dataset_ids),
                OutboxRecord.event_type.in_(sync_types),
                OutboxRecord.processed == False,
            )
        )
        rows = result.all()

        # Group oldest unprocessed event per dataset
        oldest_per_dataset: dict[str, datetime] = {}
        for aggregate_id, created_at in rows:
            # Ensure timezone-aware for comparison
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=UTC)
            if aggregate_id not in oldest_per_dataset or created_at < oldest_per_dataset[aggregate_id]:
                oldest_per_dataset[aggregate_id] = created_at

        now = datetime.now(UTC)
        statuses: dict[str, str] = {}
        error_threshold_seconds = 60

        for dataset_id in dataset_ids:
            if dataset_id not in oldest_per_dataset:
                statuses[dataset_id] = "synced"
            else:
                age = (now - oldest_per_dataset[dataset_id]).total_seconds()
                statuses[dataset_id] = "error" if age > error_threshold_seconds else "pending"

        return statuses

    @handle_repository_exceptions
    async def list_uploads_for_source(self, source_id: str) -> list[OutboxRecord]:
        """List every UploadRecorded event for a source, oldest first.

        The ``source_id`` lives in the JSON ``payload`` (the ``aggregate_id`` is
        the upload_id), so the rows are fetched by event type + ordered in the DB
        and filtered by ``payload["source_id"]`` in Python. This stays DB-agnostic
        (no JSON-path WHERE) and is fine at the low per-source upload volume.

        Includes BOTH processed (ingested) and unprocessed (pending) records — a
        source's full file list spans the whole upload history.
        """
        result = await self._session.execute(
            select(OutboxRecord)
            .where(OutboxRecord.event_type == "UploadRecorded")
            .order_by(OutboxRecord.created_at.asc())
        )
        records = result.scalars().all()
        return [record for record in records if record.payload.get("source_id") == source_id]

    @handle_repository_exceptions
    async def get_file_received_event_by_id(self, record_id: str) -> OutboxEvent | None:
        """Fetch a file received event by its OutboxRecord ID."""
        record = await self._get_event_by_id(record_id, raise_if_processed=True)
        if record.event_type != "UploadFileReceived":
            raise OutboxRepositoryError(f"Event {record_id} is not an UploadFileReceived event")
        return to_event(record.event_type, record.payload)

    async def _append_event(
        self,
        aggregate_type: str,
        aggregate_id: str,
        event: OutboxEvent,
    ) -> OutboxRecord:
        """Append a domain event to the outbox.

        Args:
            aggregate_type: Type of aggregate (e.g., "project")
            aggregate_id: ID of the aggregate instance
            event: Domain event to store

        Returns:
            Created OutboxRecord
        """
        payload = asdict(event)
        record = OutboxRecord(
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            event_type=type(event).__name__,
            payload=payload,
        )

        self._session.add(record)
        await self._session.flush()
        await self._session.refresh(record)
        return record

    async def _get_event_by_id(self, record_id: str, raise_if_processed: bool = False) -> OutboxRecord:
        """Fetch a single event by its OutboxRecord ID.

        Args:
            record_id: The ID of the OutboxRecord

        Returns:
            OutboxRecord

        Raises:
            NoResultFound: If record not found
            OutboxRepositoryError: If record already processed
        """
        result = await self._session.execute(select(OutboxRecord).where(OutboxRecord.id == record_id))
        record = result.scalar_one()

        if raise_if_processed and record.processed:
            raise OutboxRepositoryError(f"Event {record_id} has already been processed")

        return record

    @handle_repository_exceptions
    async def update_payload(
        self,
        record_id: str,
        updates: dict,
    ) -> None:
        """Merge key-value pairs into an existing outbox record's payload."""
        record = await self._get_event_by_id(record_id)
        merged = {**record.payload, **updates}
        await self._session.execute(update(OutboxRecord).where(OutboxRecord.id == record_id).values(payload=merged))
        await self._session.flush()

    @handle_repository_exceptions
    async def mark_processed(
        self,
        record_ids: list[str],
    ) -> None:
        """Mark events as processed.

        Args:
            record_ids: List of OutboxRecord IDs to mark as processed
        """
        if not record_ids:
            return

        await self._session.execute(
            update(OutboxRecord)
            .where(OutboxRecord.id.in_(record_ids))
            .values(processed=True, processed_at=datetime.now(UTC))
        )
        await self._session.flush()
