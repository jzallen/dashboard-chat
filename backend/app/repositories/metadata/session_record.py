"""SessionRecord ORM model for chat sessions (Stream threads)."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base

if TYPE_CHECKING:
    from .project_memory_record import ProjectMemoryRecord


class SessionRecord(Base):
    """Chat session backed by a Stream thread within a project memory."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    memory_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("project_memories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stream_thread_id: Mapped[str] = mapped_column(String(100), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    org_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    active_dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    last_active_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)

    # Relationships
    memory: Mapped["ProjectMemoryRecord"] = relationship("ProjectMemoryRecord", back_populates="sessions")

    def __repr__(self) -> str:
        return f"<SessionRecord(id={self.id}, title={self.title})>"
