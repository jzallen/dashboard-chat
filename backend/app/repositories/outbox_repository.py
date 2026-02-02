"""OutboxRepository - Event storage and state reconstruction.

Provides event sourcing capabilities:
- Append domain events to the outbox
- Reconstruct aggregate state from events
- Support for future event publishing
"""

from dataclasses import asdict
from datetime import datetime
from typing import Any

from sqlalchemy import select, update

from .outbox_record import OutboxRecord
from ..models.upload_domain_events import (
    UploadDomainEvent,
    UploadFileReceived,
    UploadProcessingStarted,
    UploadCompleted,
    UploadFailed,
    to_domain_event,
)
from ..models.upload_event import UploadEvent


class OutboxRepository:
    """Repository for outbox event storage and state reconstruction.

    Provides event sourcing for aggregates:
    - Append events with automatic serialization
    - Fetch events for state reconstruction
    - Mark events as processed for publishing
    """

    AGGREGATE_TYPE_UPLOAD = "Upload"

    def __init__(self, session: "RestrictedSession") -> None:
        """Initialize with restricted session.

        Args:
            session: RestrictedSession (only exposes execute/add/flush/refresh/delete)
        """
        self._session = session

    async def append_event(
        self,
        aggregate_type: str,
        aggregate_id: str,
        event: UploadDomainEvent,
    ) -> OutboxRecord:
        """Append a domain event to the outbox.

        Args:
            aggregate_type: Type of aggregate (e.g., "Upload")
            aggregate_id: ID of the aggregate instance
            event: Domain event to store

        Returns:
            Created OutboxRecord
        """
        # Serialize event to dict, handling datetime
        payload = asdict(event)
        if "timestamp" in payload and isinstance(payload["timestamp"], datetime):
            payload["timestamp"] = payload["timestamp"].isoformat()

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

    async def get_events_for_aggregate(
        self,
        aggregate_type: str,
        aggregate_id: str,
    ) -> list[OutboxRecord]:
        """Fetch all events for an aggregate in chronological order.

        Args:
            aggregate_type: Type of aggregate
            aggregate_id: ID of the aggregate instance

        Returns:
            List of OutboxRecords ordered by created_at
        """
        result = await self._session.execute(
            select(OutboxRecord)
            .where(OutboxRecord.aggregate_type == aggregate_type)
            .where(OutboxRecord.aggregate_id == aggregate_id)
            .order_by(OutboxRecord.created_at.asc())
        )
        return list(result.scalars().all())

    async def get_unprocessed(
        self,
        limit: int = 100,
    ) -> list[OutboxRecord]:
        """Fetch unprocessed events for publishing.

        Args:
            limit: Maximum number of events to return

        Returns:
            List of unprocessed OutboxRecords ordered by created_at
        """
        result = await self._session.execute(
            select(OutboxRecord)
            .where(OutboxRecord.processed == False)
            .order_by(OutboxRecord.created_at.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

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
            .values(processed=True, processed_at=datetime.utcnow())
        )
        await self._session.flush()

    async def reconstruct_upload_state(
        self,
        upload_id: str,
    ) -> UploadEvent | None:
        """Reconstruct UploadEvent state from events.

        Applies all events for the upload aggregate in order
        to build the current state.

        Args:
            upload_id: The upload aggregate ID

        Returns:
            Reconstructed UploadEvent or None if no events found
        """
        records = await self.get_events_for_aggregate(
            self.AGGREGATE_TYPE_UPLOAD,
            upload_id,
        )

        if not records:
            return None

        # Initialize state from first event (must be UploadFileReceived)
        first_record = records[0]
        if first_record.event_type != "UploadFileReceived":
            raise ValueError(
                f"First event must be UploadFileReceived, got {first_record.event_type}"
            )

        first_event = to_domain_event(first_record.event_type, first_record.payload)
        if not isinstance(first_event, UploadFileReceived):
            raise ValueError("First event must be UploadFileReceived")

        # Build initial state
        state = {
            "id": first_event.upload_id,
            "project_id": first_event.project_id,
            "raw_storage_path": first_event.raw_storage_path,
            "original_filename": first_event.original_filename,
            "file_size": first_event.file_size,
            "row_count": first_event.row_count,
            "dataset_id": first_event.dataset_id,
            "status": "pending",
            "error_message": None,
            "created_at": first_event.timestamp,
            "processed_at": None,
        }

        # Apply subsequent events
        for record in records[1:]:
            event = to_domain_event(record.event_type, record.payload)

            match event:
                case UploadProcessingStarted():
                    state["status"] = "processing"
                case UploadCompleted():
                    state["status"] = "completed"
                    state["dataset_id"] = event.dataset_id
                    state["processed_at"] = event.timestamp
                case UploadFailed():
                    state["status"] = "failed"
                    state["error_message"] = event.error_message
                    state["processed_at"] = event.timestamp

        return UploadEvent(**state)

    async def list_uploads(
        self,
        project_id: str | None = None,
        dataset_id: str | None = None,
    ) -> list[UploadEvent]:
        """List all uploads, reconstructing state from events.

        Args:
            project_id: Optional filter by project
            dataset_id: Optional filter by dataset

        Returns:
            List of reconstructed UploadEvent objects
        """
        # Get all UploadFileReceived events to find uploads
        query = (
            select(OutboxRecord)
            .where(OutboxRecord.aggregate_type == self.AGGREGATE_TYPE_UPLOAD)
            .where(OutboxRecord.event_type == "UploadFileReceived")
            .order_by(OutboxRecord.created_at.desc())
        )

        result = await self._session.execute(query)
        initial_events = result.scalars().all()

        # Reconstruct each upload's state and filter in-memory
        # This approach works across all DB backends (SQLite, PostgreSQL)
        uploads = []
        for initial_record in initial_events:
            # Filter by project_id from the initial event payload
            if project_id and initial_record.payload.get("project_id") != project_id:
                continue

            upload = await self.reconstruct_upload_state(initial_record.aggregate_id)
            if upload:
                # Apply dataset_id filter after reconstruction
                if dataset_id and upload.dataset_id != dataset_id:
                    continue
                uploads.append(upload)

        return uploads
