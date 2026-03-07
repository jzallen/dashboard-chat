"""Report domain model - authoritative business object.

This module contains the Report domain model for mart-layer dbt models
that produce final analytical outputs (facts or dimensions).
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class Report:
    """Report domain model (authoritative business object).

    A report represents a mart-layer transformation in the dbt pipeline.
    It references source datasets or views via source_refs and applies
    a SQL transformation to produce facts or dimensions.

    Attributes:
        id: Unique identifier (UUID)
        project_id: Parent project UUID
        org_id: Organization ID for multi-tenancy
        name: Human-readable report name
        sql_definition: SQL query defining the transformation
        report_type: Either "fact" or "dimension"
        source_refs: List of source references (dataset or view IDs)
        description: Optional report description
        domain: Business domain (default: Organization)
        columns_metadata: Semantic column metadata
        materialization: dbt materialization strategy (default: view)
        created_at: When the report was created
        updated_at: When the report was last modified
    """

    id: str
    project_id: str
    org_id: str
    name: str
    sql_definition: str
    report_type: str
    source_refs: list[dict[str, str]] = field(default_factory=list)
    description: str | None = None
    domain: str = "Organization"
    columns_metadata: list[dict] = field(default_factory=list)
    materialization: str = "view"
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_record(cls, record) -> "Report":
        """Create Report domain object from ORM record."""
        return cls(
            id=record.id,
            project_id=record.project_id,
            org_id=record.org_id,
            name=record.name,
            description=record.description,
            sql_definition=record.sql_definition,
            report_type=record.report_type,
            source_refs=record.source_refs or [],
            domain=record.domain,
            columns_metadata=record.columns_metadata or [],
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
            "report_type": self.report_type,
            "source_refs": self.source_refs,
            "domain": self.domain,
            "columns_metadata": self.columns_metadata,
            "materialization": self.materialization,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
