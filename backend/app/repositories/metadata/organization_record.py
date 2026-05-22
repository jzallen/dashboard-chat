"""OrganizationRecord ORM model for database persistence."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class OrganizationRecord(Base):
    """Organization database record for multi-tenant org management."""

    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )

    def __repr__(self) -> str:
        return f"<OrganizationRecord(id={self.id}, name={self.name})>"
