"""UploadEvent ORM record for persistence layer.

Tracks file uploads for processing and audit trail.
The upload event stores the raw file path and inferred schema,
allowing users to select partition fields before dataset creation.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .project_record import ProjectRecord
    from .dataset_record import DatasetRecord


class UploadEventRecord(Base):
    """Upload event ORM record for persistence.

    Tracks upload events through their lifecycle:
    - pending: File uploaded, awaiting user partition selection
    - processing: Dataset creation in progress
    - completed: Dataset created successfully
    - failed: Processing failed (error_message populated)

    Storage paths:
    - raw_storage_path: uploads/{project_id}/{upload_id}.csv (permanent)
    - Dataset storage: datasets/{project_id}/{dataset_id}/ (partitioned parquet)
    """

    __tablename__ = "upload_events"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dataset_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("datasets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        Enum("pending", "processing", "completed", "failed", name="upload_status"),
        nullable=False,
        default="pending",
    )
    raw_storage_path: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
        comment="S3 path to original uploaded file (uploads/{project_id}/{upload_id}.csv)",
    )
    original_filename: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    file_size: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    schema_config: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="Inferred schema for partition field selection",
    )
    row_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    # Relationships
    project: Mapped["ProjectRecord"] = relationship(
        "ProjectRecord",
        back_populates="upload_events",
    )
    dataset: Mapped["DatasetRecord | None"] = relationship(
        "DatasetRecord",
        back_populates="upload_events",
    )

    def __repr__(self) -> str:
        return f"<UploadEventRecord(id={self.id}, status={self.status}, file={self.original_filename})>"
