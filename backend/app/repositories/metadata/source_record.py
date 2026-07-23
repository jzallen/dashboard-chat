"""Source ORM record for persistence layer.

The authoritative Source is the domain model in ``app/models/source.py``;
this record exists only for database persistence. A Source is a logical table
backed by one or more uploaded files sharing a schema; its public ``SELECT *``
view is a ``Dataset`` linked back via ``datasets.source_id``.

Org scoping is transitive via ``project_id`` (the projects table carries
``org_id``) — there is intentionally NO ``org_id`` column or index here.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base

if TYPE_CHECKING:
    from .project_record import ProjectRecord


class SourceRecord(Base):
    """Source ORM record for persistence only."""

    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(
        String(36),  # UUID primary key
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # The locked schema used to match files appended to this source.
    # Format mirrors DatasetRecord.schema_config: { "fields": { ... } }
    schema_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )

    # Cold-storage lifecycle. ``archived_at`` is set when the source is moved to
    # Cold Storage; ``retention_until`` = ``archived_at`` + the 90-day retention
    # window. Both are cleared on restore. List endpoints default-exclude rows
    # where ``archived_at IS NOT NULL``. Org-scoped transitively via project_id,
    # so no index is added here (mirrors DatasetRecord).
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    # Relationships
    project: Mapped["ProjectRecord"] = relationship("ProjectRecord", back_populates="sources")

    def __repr__(self) -> str:
        return f"<SourceRecord(id={self.id}, name={self.name})>"
