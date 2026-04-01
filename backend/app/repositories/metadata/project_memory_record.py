"""ProjectMemoryRecord ORM model for project-to-Stream-channel mapping."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base

if TYPE_CHECKING:
    from .project_record import ProjectRecord
    from .session_record import SessionRecord


class ProjectMemoryRecord(Base):
    """Maps a project to its Stream channel (memory)."""

    __tablename__ = "project_memories"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    org_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    stream_channel_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)

    # Relationships
    project: Mapped["ProjectRecord"] = relationship("ProjectRecord")
    sessions: Mapped[list["SessionRecord"]] = relationship(
        "SessionRecord", back_populates="memory", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<ProjectMemoryRecord(id={self.id}, project_id={self.project_id})>"
