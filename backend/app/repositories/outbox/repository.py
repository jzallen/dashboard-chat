"""OutboxRepository - Event storage for the outbox pattern.

Provides event sourcing capabilities:
- Append domain events to the outbox
- Query events for state reconstruction (by use cases)
- Support for future event publishing
"""

from dataclasses import asdict
from datetime import datetime, timezone
from functools import wraps
from typing import Callable, TypeVar, ParamSpec, Union

from sqlalchemy import select, update
from sqlalchemy.exc import NoResultFound, SQLAlchemyError

from ..exceptions import OutboxRepositoryError
from .outbox_record import OutboxRecord
from .events import to_event, OutboxEvent, UploadFileReceived, TransformsCreated, TransformsUpdated


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
    ) -> OutboxEvent:
        event = UploadFileReceived(
            project_id=project_id,
            raw_storage_path=f"uploads/{project_id}/{file_name}",
            original_filename=file_name,
            file_size=file_size,
            dataset_id=dataset_id,
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
        result = await self._session.execute(
            select(OutboxRecord).where(OutboxRecord.id == record_id)
        )
        record = result.scalar_one()

        if raise_if_processed and record.processed:
            raise OutboxRepositoryError(f"Event {record_id} has already been processed")

        return record

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
            .values(processed=True, processed_at=datetime.now(timezone.utc))
        )
        await self._session.flush()
