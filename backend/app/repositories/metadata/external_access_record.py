"""ExternalAccessRecord ORM model for external SQL access persistence."""

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class ExternalAccessRecord(Base):
    """External SQL access record for a project.

    Tracks pg_duckdb schema/role provisioning and credentials per project.
    Soft-disabled on revocation (enabled=False) for audit trail.
    """

    __tablename__ = "external_access"

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
    pg_schema: Mapped[str] = mapped_column(String(255), nullable=False)
    pg_role: Mapped[str] = mapped_column(String(255), nullable=False)
    pg_password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    environment_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    environment_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    environment_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    proxy_container_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    environment_status: Mapped[str] = mapped_column(String(50), server_default="running", nullable=False)
    status_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )

    def __repr__(self) -> str:
        return f"<ExternalAccessRecord(id={self.id}, project_id={self.project_id}, enabled={self.enabled})>"
