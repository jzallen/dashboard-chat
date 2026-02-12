"""ProjectRecord ORM model for database persistence."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base

if TYPE_CHECKING:
    from .dataset_record import DatasetRecord


class ProjectRecord(Base):
    """Project database record for organizing datasets and transforms."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    datasets: Mapped[list["DatasetRecord"]] = relationship(
        "DatasetRecord", back_populates="project", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<ProjectRecord(id={self.id}, name={self.name})>"
