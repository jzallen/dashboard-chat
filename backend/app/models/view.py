"""View domain model - authoritative business object.

This module contains the View domain model for intermediate dbt model layers
that transform source data using SQL definitions.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class View:
    """View domain model (authoritative business object).

    A view represents an intermediate transformation layer in the dbt pipeline.
    It references source datasets or other views via source_refs and applies
    a SQL transformation defined in sql_definition.

    Attributes:
        id: Unique identifier (UUID)
        project_id: Parent project UUID
        org_id: Organization ID for multi-tenancy
        name: Human-readable view name
        sql_definition: SQL query defining the transformation
        source_refs: List of source references (dataset or view IDs)
        description: Optional view description
        materialization: dbt materialization strategy (default: ephemeral)
        created_at: When the view was created
        updated_at: When the view was last modified
    """

    id: str
    project_id: str
    org_id: str
    name: str
    sql_definition: str
    source_refs: list[dict[str, str]] = field(default_factory=list)
    description: str | None = None
    materialization: str = "ephemeral"
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_record(cls, record) -> "View":
        """Create View domain object from ORM record."""
        return cls(
            id=record.id,
            project_id=record.project_id,
            org_id=record.org_id,
            name=record.name,
            description=record.description,
            sql_definition=record.sql_definition,
            source_refs=record.source_refs or [],
            materialization=record.materialization,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    def serialize(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict for HTTP responses."""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "org_id": self.org_id,
            "name": self.name,
            "description": self.description,
            "sql_definition": self.sql_definition,
            "source_refs": self.source_refs,
            "materialization": self.materialization,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
