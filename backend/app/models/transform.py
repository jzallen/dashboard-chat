"""Transform domain model - authoritative business object.

This module contains the Transform domain model. SQL generation is now handled
by the backend using Ibis expressions derived from the condition_json.
"""

from dataclasses import dataclass

from ..types import QueryBuilderJSON


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
        is_active: Whether the transform is currently applied
    """

    id: str | None
    name: str
    condition_json: QueryBuilderJSON | None  # Value object for Ibis conversion
    condition_sql: str | None = None  # Keep for display/backwards compat
    description: str | None = None
    is_active: bool = True
