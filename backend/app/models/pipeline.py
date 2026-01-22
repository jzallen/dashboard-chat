"""Filter pipeline model for storing RAQB filters."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .dataset import Dataset
    from .pipeline_run import PipelineRun


class FilterPipeline(Base):
    """Filter pipeline storing both RAQB JSON and cached SQL.

    The RAQB JSON is the canonical format used for:
    - Frontend TanStack conversion
    - Display and editing

    The cached SQL is pre-generated for:
    - Backend execution efficiency
    - PostgreSQL filtering
    """

    __tablename__ = "filter_pipelines"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    dataset_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # RAQB tree format - canonical representation
    raqb_json: Mapped[dict] = mapped_column(JSON, nullable=False)

    # Pre-generated SQL WHERE clause for backend execution
    cached_sql: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Versioning
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Metadata from NL generation
    nl_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    dataset: Mapped["Dataset"] = relationship("Dataset", back_populates="pipelines")
    runs: Mapped[list["PipelineRun"]] = relationship(
        "PipelineRun", back_populates="pipeline", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<FilterPipeline(id={self.id}, name={self.name}, version={self.version})>"
