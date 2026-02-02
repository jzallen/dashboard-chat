"""Dataset ORM record for persistence layer.

Note: The authoritative Dataset is the domain model in app/models/.
This is just for database persistence.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .transform_record import TransformRecord
    from .project_record import ProjectRecord
    from .upload_event_record import UploadEventRecord


class DatasetRecord(Base):
    """Dataset ORM record for persistence only.

    Changes from original Dataset model:
    - ID is UUID (String(36))
    - storage_path field added for Parquet file location
    - table_name made nullable (deprecated field, will be removed)
    - Class name changed to DatasetRecord to distinguish from domain model
    """

    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(
        String(36),  # UUID primary key
        primary_key=True,
    )
    storage_path: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
        comment="S3/MinIO storage path for parquet file"
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Deprecated field (will be removed in future migration)
    table_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=False
    )

    # JSON schema config for RAQB field definitions
    # Format: { "fields": { "column_name": { "type": "text|number|boolean|select", ... } } }
    schema_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Partition configuration for hive-style partitioning
    # Format: ["field1", "field2"] - list of field names to partition by
    partition_fields: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Metadata
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    project: Mapped["ProjectRecord"] = relationship("ProjectRecord", back_populates="datasets")
    transforms: Mapped[list["TransformRecord"]] = relationship(
        "TransformRecord", back_populates="dataset", cascade="all, delete-orphan"
    )
    upload_events: Mapped[list["UploadEventRecord"]] = relationship(
        "UploadEventRecord", back_populates="dataset"
    )

    def __repr__(self) -> str:
        return f"<DatasetRecord(id={self.id}, name={self.name})>"
