"""Source domain model - authoritative business object.

A ``Source`` is a logical table backed by one or more uploaded files that
share a schema (dbt-style). The public ``SELECT *`` view over a Source is a
``Dataset`` linked back via ``datasets.source_id``. This module defines the
Source domain object only; persistence lives in the repository layer.
"""

from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any

# 90-day recoverable Cold-Storage window before a source may be purged.
RETENTION_WINDOW = timedelta(days=90)


def _iso_or_none(value: Any) -> str | None:
    """ISO-8601 string for a datetime, or None when unset."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else value


@dataclass(frozen=True, slots=True)
class Source:
    """Source domain model (authoritative business object).

    Identity + metadata (id, project_id, name), the locked ``schema_config``
    used to match subsequent uploads, ownership (``created_by``), and
    timestamps. ORM/dict coercion via ``from_record``; HTTP serialization via
    ``serialize``. No persistence concerns.
    """

    id: str  # UUID primary key
    project_id: str | None = None  # Parent project UUID
    name: str = "New Source"  # Display name (business default)
    schema_config: dict[str, Any] = field(
        default_factory=dict
    )  # The locked schema used to match files appended to this source
    created_by: str | None = None  # User ID of creator
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None
    # Cold-storage lifecycle: ``archived_at`` is stamped when the source is moved
    # to Cold Storage; ``retention_until`` is ``archived_at`` + the 90-day retention
    # window. Both are None for a live source and cleared on restore.
    archived_at: datetime | str | None = None
    retention_until: datetime | str | None = None

    @property
    def is_archived(self) -> bool:
        """True when the source currently sits in Cold Storage."""
        return self.archived_at is not None

    def mark_archived(self, should_archive: bool) -> "Source":
        """Return this source transitioned to the requested Cold-Storage state.

        ``should_archive`` carries the caller's intent. ``True`` stamps
        ``archived_at = now`` and ``retention_until = now + RETENTION_WINDOW``;
        ``False`` clears both. Each direction is idempotent — an already-archived
        source keeps its original archive time (the retention clock never advances)
        and an already-active source stays cleared — returning ``self`` unchanged
        when the requested state already holds.
        """
        if is_already_archived := should_archive and self.is_archived:  # noqa: F841
            return self
        if should_archive:
            archived_at = datetime.now(UTC)
            return replace(self, archived_at=archived_at, retention_until=archived_at + RETENTION_WINDOW)
        if is_already_restored := not self.is_archived:  # noqa: F841
            return self
        # restore source
        return replace(self, archived_at=None, retention_until=None)

    @classmethod
    def from_record(cls, record: Any) -> "Source":
        """Create a Source domain object from an ORM record."""
        return cls(
            id=record.id,
            project_id=record.project_id,
            name=record.name,
            schema_config=record.schema_config or {},
            created_by=getattr(record, "created_by", None),
            created_at=getattr(record, "created_at", None),
            updated_at=getattr(record, "updated_at", None),
            archived_at=getattr(record, "archived_at", None),
            retention_until=getattr(record, "retention_until", None),
        )

    def serialize(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict for HTTP responses."""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "name": self.name,
            "schema_config": self.schema_config,
            "created_by": self.created_by,
            "created_at": _iso_or_none(self.created_at),
            "updated_at": _iso_or_none(self.updated_at),
            "archived_at": _iso_or_none(self.archived_at),
            "retention_until": _iso_or_none(self.retention_until),
        }
