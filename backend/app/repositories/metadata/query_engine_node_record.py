"""QueryEngineNodeRecord ORM model for org-level query engine nodes."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class QueryEngineNodeRecord(Base):
    """Persistent query engine node scoped to an organization.

    Represents a pg_duckdb instance that serves as the analytical
    query layer for all projects within an org. The engine stores
    no data — it maps schemas and enforces permissions so queries
    resolve to Parquet files in the data lake.
    """

    __tablename__ = "query_engine_nodes"
    __table_args__ = (
        UniqueConstraint("org_id", "name", name="uq_query_engine_nodes_org_name"),
        Index("ix_query_engine_nodes_org_id", "org_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    org_id: Mapped[str] = mapped_column(String(36), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=5432)
    database: Mapped[str] = mapped_column(String(255), nullable=False)
    admin_user: Mapped[str] = mapped_column(String(255), nullable=False)
    admin_password_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), server_default="running", nullable=False)
    status_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )

    def __repr__(self) -> str:
        return f"<QueryEngineNodeRecord(id={self.id}, org_id={self.org_id}, name={self.name}, status={self.status})>"
