"""Transform domain model - authoritative business object.

This module contains the Transform domain model. SQL generation is now handled
by the backend using Ibis expressions derived from the condition_json.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from ..types import QueryBuilderJSON

TransformStatus = Literal['enabled', 'disabled', 'deleted']
TransformType = Literal['filter', 'clean', 'alias', 'map']


@dataclass(frozen=True, slots=True)
class Transform:
    """Transform domain model (authoritative business object).

    Supports four transform types:
    - filter: Row-level WHERE predicates (uses condition_json/condition_sql)
    - clean: Column-level cleaning expressions (trim, case, fill_null)
    - alias: Column rename operations
    - map: Value mapping expressions (CASE WHEN chains)

    Filter transforms use condition_json/condition_sql.
    Clean/alias/map transforms use target_column/expression_config/expression_sql.
    """

    id: str | None
    name: str
    condition_json: QueryBuilderJSON | None  # Value object for Ibis conversion (filter type)
    condition_sql: str | None = None  # SQL WHERE clause (filter type)
    description: str | None = None
    status: TransformStatus = 'enabled'
    transform_type: TransformType = 'filter'
    target_column: str | None = None  # Column targeted by clean/alias/map transforms
    expression_sql: str | None = None  # Server-generated SQL for clean/alias/map
    expression_config: dict[str, Any] | None = None  # Structured JSON config for clean/alias/map
    created_at: datetime | None = None  # For ordering cleaning transforms

    @property
    def is_enabled(self) -> bool:
        """Whether the transform is currently enabled."""
        return self.status == 'enabled'

    def __getitem__(self, key: str) -> object:
        """Allow dict-like access for SQLAlchemy bulk operations."""
        return getattr(self, key)

    def keys(self) -> list[str]:
        """Return field names for SQLAlchemy bulk operations."""
        return [
            'id', 'name', 'condition_json', 'condition_sql', 'description', 'status',
            'transform_type', 'target_column', 'expression_sql', 'expression_config',
        ]

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
            'transform_type': self.transform_type,
            'target_column': self.target_column,
            'expression_sql': self.expression_sql,
            'expression_config': self.expression_config,
        }
