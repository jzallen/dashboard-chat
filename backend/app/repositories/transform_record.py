"""Transform ORM record for persistence layer.

Note: The authoritative Transform is the domain model in app/models/.
This is just for database persistence.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .dataset_record import DatasetRecord
    from ..models.pipeline_run import PipelineRun


class TransformRecord(Base):
    """Transform ORM record for persistence only.

    Changes from original Transform model:
    - raqb_json renamed to condition_json (implementation-agnostic)
    - cached_sql renamed to condition_sql (implementation-agnostic)
    - Class name changed to TransformRecord to distinguish from domain model
    """

    __tablename__ = "transforms"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    dataset_id: Mapped[str] = mapped_column(
        String(36),  # UUID foreign key to DatasetRecord.id
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Implementation-agnostic field names (renamed from raqb_json/cached_sql)
    condition_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    condition_sql: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Versioning
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='enabled')

    # Metadata from NL generation
    nl_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    dataset: Mapped["DatasetRecord"] = relationship("DatasetRecord", back_populates="transforms")
    runs: Mapped[list["PipelineRun"]] = relationship(
        "PipelineRun", back_populates="transform", cascade="all, delete-orphan"
    )

    @property
    def is_active(self) -> bool:
        """Backwards-compatible property: True if status is 'enabled'."""
        return self.status == 'enabled'

    def __repr__(self) -> str:
        return f"<TransformRecord(id={self.id}, name={self.name}, version={self.version})>"
