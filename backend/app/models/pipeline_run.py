"""Pipeline run model for tracking execution history."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .pipeline import FilterPipeline


class RunStatus:
    """Pipeline run status constants."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class PipelineRun(Base):
    """Execution history for filter pipelines."""

    __tablename__ = "pipeline_runs"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    pipeline_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("filter_pipelines.id", ondelete="CASCADE"),
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
    pipeline: Mapped["FilterPipeline"] = relationship(
        "FilterPipeline", back_populates="runs"
    )

    def __repr__(self) -> str:
        return f"<PipelineRun(id={self.id}, status={self.status})>"
