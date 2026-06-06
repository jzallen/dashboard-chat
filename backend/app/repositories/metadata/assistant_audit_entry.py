"""AssistantAuditEntry ORM — the generic assistant-audit spine (rich-catalog §2.3).

An ``AssistantAuditEntry`` is the persisted log of an assistant action taken
against a lineage node (dataset / view / report). It is a GENERIC spine: scoping
columns (``org_id``/``project_id``/``node_id``/``node_kind``) that every read
filters or groups by, plus a single JSON ``payload`` carrying the variable
content (``{tool, say, tag, args?}``). There are NO per-subtype columns.

The FK is REVERSED: a ``Transform`` points UP at the entry it produced via
``transforms.assistant_audit_entry_id`` (see :class:`TransformRecord`), not the
other way round. An audit entry is transform-type (toggleable) iff a Transform
references it.

Note: the authoritative model is the persistence record here; this slice is
read-only (the UI audit projection), so there is no rich domain class yet.
"""

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class AssistantAuditEntry(Base):
    """Generic assistant-audit entry (the spine)."""

    __tablename__ = "assistant_audit_entries"

    id: Mapped[str] = mapped_column(
        Text,
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    org_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    node_kind: Mapped[str] = mapped_column(Text, nullable=False)
    # The variable audit content: { tool, say, tag, args? }.
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        default=lambda: datetime.now(UTC),
    )

    def __repr__(self) -> str:
        return f"<AssistantAuditEntry(id={self.id}, node_id={self.node_id})>"
