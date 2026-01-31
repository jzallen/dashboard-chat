"""PipelineRunRecord ORM model for tracking transform execution history.

Note: Currently unused - kept for future auditing functionality.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .transform_record import TransformRecord


class RunStatus:
    """Transform run status constants."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class PipelineRunRecord(Base):
    """Execution history record for transforms.

    Note: Currently unused - kept for future auditing functionality.
    """

    __tablename__ = "pipeline_runs"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    pipeline_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("transforms.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Run status (stored as string for SQLite compatibility)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
    )

    # Result metrics
    input_row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    execution_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Error info if failed
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamps
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    transform: Mapped["TransformRecord"] = relationship(
        "TransformRecord", back_populates="runs"
    )

    def __repr__(self) -> str:
        return f"<PipelineRunRecord(id={self.id}, status={self.status})>"
