"""ReportRecord ORM record for persistence layer.

Note: The authoritative Report is the domain model in app/models/.
This is just for database persistence.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base

if TYPE_CHECKING:
    from .project_record import ProjectRecord


class ReportRecord(Base):
    """Report ORM record for persistence only.

    Represents a mart-layer dbt model that produces final analytical
    outputs (facts or dimensions) from views and datasets.
    """

    __tablename__ = "reports"

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
    report_type: Mapped[str] = mapped_column(String(20), nullable=False)
    domain: Mapped[str] = mapped_column(String(100), nullable=False, default="Organization")
    columns_metadata: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    materialization: Mapped[str] = mapped_column(String(20), nullable=False, default="view")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    project: Mapped["ProjectRecord"] = relationship("ProjectRecord", back_populates="reports")

    def __repr__(self) -> str:
        return f"<ReportRecord(id={self.id}, name={self.name})>"
