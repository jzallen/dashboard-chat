"""OutboxRecord ORM model for event persistence.

The outbox pattern stores domain events for:
1. Event sourcing - Reconstructing aggregate state from events
2. Reliable messaging - Future event publishing to message queues
"""

from datetime import datetime, timezone
from uuid_utils import uuid7

from sqlalchemy import Boolean, DateTime, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class OutboxRecord(Base):
    """Outbox message record for event persistence.

    Stores domain events with metadata for:
    - State reconstruction (aggregate_type + aggregate_id)
    - Event publishing (processed flag)
    - Audit trail (created_at, payload)
    """

    __tablename__ = "outbox_messages"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid7()),
    )
    aggregate_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        comment="Type of aggregate (e.g., 'Upload')",
    )
    aggregate_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        index=True,
        comment="ID of the aggregate instance",
    )
    event_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="Domain event class name (e.g., 'UploadFileReceived')",
    )
    payload: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        comment="Serialized event data",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    processed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        index=True,
        comment="Whether event has been published to message queue",
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
        comment="When event was published",
    )

    # Composite index for efficient aggregate event queries
    __table_args__ = (
        Index(
            "ix_outbox_aggregate_events",
            "aggregate_type",
            "aggregate_id",
            "created_at",
        ),
    )

    def __repr__(self) -> str:
        return f"<OutboxRecord(id={self.id}, type={self.event_type}, aggregate={self.aggregate_type}/{self.aggregate_id})>"
