"""ViewRecord ORM record for persistence layer.

Note: The authoritative View is the domain model in app/models/.
This is just for database persistence.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base

if TYPE_CHECKING:
    from .project_record import ProjectRecord


class ViewRecord(Base):
    """View ORM record for persistence only.

    Represents an intermediate dbt model layer that transforms
    source data using SQL definitions.
    """

    __tablename__ = "views"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    org_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sql_definition: Mapped[str] = mapped_column(Text, nullable=False)
    source_refs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    materialization: Mapped[str] = mapped_column(String(20), nullable=False, default="ephemeral")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    project: Mapped["ProjectRecord"] = relationship("ProjectRecord", back_populates="views")

    def __repr__(self) -> str:
        return f"<ViewRecord(id={self.id}, name={self.name})>"
