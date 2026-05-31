"""Dataset ORM record for persistence layer.

Note: The authoritative Dataset is the domain model in app/models/.
This is just for database persistence.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Computed, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base

if TYPE_CHECKING:
    from .project_record import ProjectRecord
    from .transform_record import TransformRecord


class DatasetRecord(Base):
    """Dataset ORM record for persistence only.

    Changes from original Dataset model:
    - ID is UUID (String(36))
    - storage_path field added for Parquet file location
    - Class name changed to DatasetRecord to distinguish from domain model
    """

    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(
        String(36),  # UUID primary key
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    storage_path: Mapped[str] = mapped_column(
        Computed("'datasets/' || project_id || '/' || id || '/'"),
        unique=True,
        index=True,
        nullable=False,
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # MR-6: editable source display name. Nullable; the UI falls back to ``name``
    # when unset, and the underlying filename/``name`` is never mutated by an edit.
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # MR-7: cold-storage / retention. Both nullable and UTC-valued (mirrors
    # ``created_at``/``updated_at``). ``archived_at`` is set when the source is moved
    # to cold storage; ``retention_until`` = ``archived_at`` + the 90-day retention
    # window (computed server-side at archive time). Both are cleared on restore.
    # List endpoints default-exclude rows where ``archived_at IS NOT NULL``.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    # Column names + types for query builder (RAQB), table UI, and SQL generation
    # Format: { "fields": { "column_name": { "type": "text|number|boolean|select", ... } } }
    schema_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Partition configuration for hive-style partitioning
    # Format: ["field1", "field2"] - list of field names to partition by
    partition_fields: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Per-column value statistics injected into the chat LLM system prompt
    # so it can map vague user references to actual data values.
    # Format: { "col_name": { "type": "text", "sample_values": [...], "unique_count": N, ... } }
    column_profiles: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)

    # Plugin-provided context injected into LLM system prompt (e.g., HL7v2 column conventions)
    format_context: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    # Total row count snapshotted at ingestion. Nullable for legacy rows
    # created before this field existed; the GET response surfaces the raw value.
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    project: Mapped["ProjectRecord"] = relationship("ProjectRecord", back_populates="datasets")
    transforms: Mapped[list["TransformRecord"]] = relationship(
        "TransformRecord", back_populates="dataset", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<DatasetRecord(id={self.id}, name={self.name})>"
