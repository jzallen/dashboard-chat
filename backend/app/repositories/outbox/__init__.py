"""Outbox repository package for event storage.

Provides event sourcing capabilities:
- Append domain events to the outbox
- Query events for state reconstruction
- Support for future event publishing
"""

from typing import Protocol

from .events import OutboxEvent
from .outbox_record import OutboxRecord


class OutboxRepositoryProtocol(Protocol):
    """Protocol defining the outbox repository interface."""

    async def append_event(
        self,
        aggregate_type: str,
        aggregate_id: str,
        event: OutboxEvent,
    ) -> OutboxRecord:
        """Append a domain event to the outbox."""
        ...

    async def get_events_for_aggregate(
        self,
        aggregate_type: str,
        aggregate_id: str,
    ) -> list[OutboxRecord]:
        """Fetch all events for an aggregate in chronological order."""
        ...

    async def get_events_by_type(
        self,
        aggregate_type: str,
        aggregate_id: str,
        event_type: str,
    ) -> list[OutboxRecord]:
        """Fetch events of a specific type for an aggregate."""
        ...

    async def get_unprocessed(
        self,
        limit: int = 100,
    ) -> list[OutboxRecord]:
        """Fetch unprocessed events for publishing."""
        ...

    async def mark_processed(
        self,
        record_ids: list[str],
    ) -> None:
        """Mark events as processed."""
        ...


from .repository import OutboxRepository  # noqa: E402

__all__ = ["OutboxRepository", "OutboxRepositoryProtocol"]
