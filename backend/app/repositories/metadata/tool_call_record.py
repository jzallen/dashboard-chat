"""ToolCallRecord ORM — the generic tool-call audit spine (rich-catalog §2.3).

A ``ToolCallRecord`` is the persisted log of an assistant tool call made against
a lineage node (dataset / view / report). It is a GENERIC spine: scoping columns
(``org_id``/``project_id``/``node_id``/``node_kind``) that every read filters or
groups by, plus a single JSON ``payload`` carrying the variable tool content
(``{tool, say, tag, args?}``). There are NO per-subtype columns.

The FK is REVERSED: a ``Transform`` points UP at the record it produced via
``transforms.tool_call_id`` (see :class:`TransformRecord`), not the other way
round. A tool call is transform-type (toggleable) iff a Transform references it.

Note: the authoritative model is the persistence record here; this slice is
read-only (the UI audit projection), so there is no rich domain class yet.
"""

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class ToolCallRecord(Base):
    """Generic assistant tool-call audit record (the spine)."""

    __tablename__ = "tool_call_records"

    id: Mapped[str] = mapped_column(
        Text,
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    org_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    node_kind: Mapped[str] = mapped_column(Text, nullable=False)
    # The variable tool-call content: { tool, say, tag, args? }.
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        default=lambda: datetime.now(UTC),
    )

    def __repr__(self) -> str:
        return f"<ToolCallRecord(id={self.id}, node_id={self.node_id})>"
