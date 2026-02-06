"""Transform domain model - authoritative business object.

This module contains the Transform domain model. SQL generation is now handled
by the backend using Ibis expressions derived from the condition_json.
"""

from dataclasses import dataclass
from typing import Any, Literal

from ..types import QueryBuilderJSON

TransformStatus = Literal['enabled', 'disabled', 'deleted']


@dataclass(frozen=True, slots=True)
class Transform:
    """Transform domain model (authoritative business object).

    The transform stores both the RAQB JSON (for Ibis filter generation and UI
    rehydration) and the generated SQL (for display/backwards compatibility).
    SQL generation now happens on the backend via Ibis expressions.

    Attributes:
        id: Unique identifier (None for unsaved transforms)
        name: Human-readable name for the transform
        condition_json: RAQB JSON tree structure as value object
        condition_sql: SQL WHERE clause (kept for display/backwards compat)
        description: Optional description
        status: Transform status ('enabled', 'disabled', 'deleted')
    """

    id: str | None
    name: str
    condition_json: QueryBuilderJSON | None  # Value object for Ibis conversion
    condition_sql: str | None = None  # Keep for display/backwards compat
    description: str | None = None
    status: TransformStatus = 'enabled'

    @property
    def is_enabled(self) -> bool:
        """Whether the transform is currently enabled."""
        return self.status == 'enabled'

    def __getitem__(self, key: str) -> object:
        """Allow dict-like access for SQLAlchemy bulk operations."""
        return getattr(self, key)

    def keys(self) -> list[str]:
        """Return field names for SQLAlchemy bulk operations."""
        return ['id', 'name', 'condition_json', 'condition_sql', 'description', 'status']

    def __iter__(self):
        """Iterate over field names for SQLAlchemy bulk operations."""
        return iter(self.keys())

    def serialize(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict for HTTP responses."""
        return {
            'id': self.id,
            'name': self.name,
            'condition_json': dict(self.condition_json) if self.condition_json else None,
            'condition_sql': self.condition_sql,
            'description': self.description,
            'status': self.status,
        }
