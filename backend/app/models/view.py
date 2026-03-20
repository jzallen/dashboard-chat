"""View domain model - authoritative business object.

This module contains the View domain model for intermediate dbt model layers
that transform source data using SQL definitions.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any


class DisplayType(StrEnum):
    text = "text"
    category = "category"
    id = "id"
    serial = "serial"
    integer = "integer"
    decimal = "decimal"
    boolean = "boolean"
    date = "date"
    time = "time"
    datetime = "datetime"


class GrainRole(StrEnum):
    Time = "Time"
    Dimension = "Dimension"
    Entity = "Entity"
    Metric = "Metric"


@dataclass(frozen=True, slots=True)
class ViewColumn:
    name: str
    source_ref: str
    source_column: str
    display_type: DisplayType
    grain_role: GrainRole | None = None
    alias: str | None = None


@dataclass(frozen=True, slots=True)
class ViewJoin:
    left_ref: str
    left_column: str
    right_ref: str
    right_column: str
    join_type: str = "INNER"


@dataclass(frozen=True, slots=True)
class ViewFilter:
    source_ref: str
    column: str
    operator: str
    value: str | None = None


@dataclass(frozen=True, slots=True)
class ViewGrain:
    time_column: str
    dimensions: list[str] = field(default_factory=list)


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
        columns: Structured column definitions
        joins: Join definitions between sources
        filters: Filter conditions
        grain: Grain definition (time column + dimensions)
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
    columns: list[ViewColumn] = field(default_factory=list)
    joins: list[ViewJoin] = field(default_factory=list)
    filters: list[ViewFilter] = field(default_factory=list)
    grain: ViewGrain | None = None
    description: str | None = None
    materialization: str = "ephemeral"
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_record(cls, record) -> "View":
        """Create View domain object from ORM record."""
        columns = [
            ViewColumn(
                name=c["name"],
                source_ref=c["source_ref"],
                source_column=c["source_column"],
                display_type=DisplayType(c["display_type"]),
                grain_role=GrainRole(c["grain_role"]) if c.get("grain_role") else None,
                alias=c.get("alias"),
            )
            for c in (record.columns or [])
        ]
        joins = [
            ViewJoin(
                left_ref=j["left_ref"],
                left_column=j["left_column"],
                right_ref=j["right_ref"],
                right_column=j["right_column"],
                join_type=j.get("join_type", "INNER"),
            )
            for j in (record.joins or [])
        ]
        filters = [
            ViewFilter(
                source_ref=f["source_ref"],
                column=f["column"],
                operator=f["operator"],
                value=f.get("value"),
            )
            for f in (record.filters or [])
        ]
        grain_data = record.grain if hasattr(record, "grain") else None
        grain = (
            ViewGrain(
                time_column=grain_data["time_column"],
                dimensions=grain_data.get("dimensions", []),
            )
            if grain_data
            else None
        )

        return cls(
            id=record.id,
            project_id=record.project_id,
            org_id=record.org_id,
            name=record.name,
            description=record.description,
            sql_definition=record.sql_definition,
            source_refs=record.source_refs or [],
            columns=columns,
            joins=joins,
            filters=filters,
            grain=grain,
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
            "columns": [
                {
                    "name": c.name,
                    "source_ref": c.source_ref,
                    "source_column": c.source_column,
                    "display_type": c.display_type.value,
                    "grain_role": c.grain_role.value if c.grain_role else None,
                    "alias": c.alias,
                }
                for c in self.columns
            ],
            "joins": [
                {
                    "left_ref": j.left_ref,
                    "left_column": j.left_column,
                    "right_ref": j.right_ref,
                    "right_column": j.right_column,
                    "join_type": j.join_type,
                }
                for j in self.joins
            ],
            "filters": [
                {
                    "source_ref": f.source_ref,
                    "column": f.column,
                    "operator": f.operator,
                    "value": f.value,
                }
                for f in self.filters
            ],
            "grain": {
                "time_column": self.grain.time_column,
                "dimensions": self.grain.dimensions,
            }
            if self.grain
            else None,
            "materialization": self.materialization,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
