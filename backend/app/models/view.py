"""View domain model - authoritative business object.

This module contains the View domain model for intermediate dbt model layers
that transform source data using SQL definitions.

ADR-026 MR-1 promotes ``ViewFilter``, ``ViewColumn``, ``ViewJoin``, and
``ViewGrain`` from frozen dataclasses to Pydantic models. ``ViewFilter`` is a
discriminated union over ``operator`` so per-operator value typing is enforced
at the validation boundary (malformed operators are rejected before the
compiler is reached). The ``ViewFilter`` callable acts as a factory that
returns the appropriate variant based on the supplied ``operator``; existing
call sites that construct it positionally as ``ViewFilter(source_ref=..., ...)``
continue to work.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator


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


class _ImmutableModel(BaseModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)


class ViewColumn(_ImmutableModel):
    name: str
    source_ref: str
    source_column: str
    display_type: DisplayType
    grain_role: GrainRole | None = None
    alias: str | None = None


class ViewJoin(_ImmutableModel):
    left_ref: str
    left_column: str
    right_ref: str
    right_column: str
    join_type: str = "INNER"


class ViewGrain(_ImmutableModel):
    time_column: str
    dimensions: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# ViewFilter — Pydantic discriminated union over ``operator``
#
# ADR-026 MR-1 closes the SQL injection vector at sql_generator.py:160 by
# routing ``value`` through ibis literals (the closure mechanism per DWD-4).
# Per-operator value typing here is a defense-in-depth contract: malformed
# operators (e.g. ``DELETE_ALL``) are rejected by the Literal type before the
# compiler is reached, and the value shape that the compiler receives is
# guaranteed to match the operator's expected arity.
# ---------------------------------------------------------------------------


_ALLOWED_OPERATORS = frozenset(
    [
        "=",
        "!=",
        ">",
        ">=",
        "<",
        "<=",
        "IN",
        "NOT IN",
        "IS NULL",
        "IS NOT NULL",
        "LIKE",
        "NOT LIKE",
    ]
)

_NUMERIC_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


def _coerce_scalar(raw: Any) -> str | int | float:
    """Coerce a raw scalar into ``str | int | float`` preserving numeric shape.

    Wire calls from the agent's ``addFilter`` tool surface ``value`` as a string
    (``value: z.string().optional()``); the discriminated-union variants typed
    on scalar comparisons accept ``int`` / ``float`` too, so we recognize
    numeric strings and lift them. Non-numeric strings pass through unchanged.
    """
    if isinstance(raw, bool):
        return raw  # type: ignore[return-value]
    if isinstance(raw, (int, float)):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if _NUMERIC_RE.match(text):
            try:
                return int(text) if "." not in text else float(text)
            except ValueError:
                return raw
        return raw
    raise TypeError(f"unsupported scalar type for ViewFilter.value: {type(raw).__name__}")


def _parse_list_value(raw: Any) -> list[str | int | float]:
    """Normalize an ``IN`` / ``NOT IN`` value into a list of scalars.

    The agent's tool surface today emits ``value`` as a string (e.g.
    ``"'a','b'"`` or ``"(open, pending)"``); accepting both string and list at
    the parsing boundary keeps backward compatibility with that wire format
    while the canonical internal representation is a list.
    """
    if isinstance(raw, list):
        return [_coerce_scalar(item) for item in raw]
    if isinstance(raw, tuple):
        return [_coerce_scalar(item) for item in raw]
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("(") and text.endswith(")"):
            text = text[1:-1]
        parts = [p.strip() for p in text.split(",") if p.strip() != ""]
        cleaned: list[str | int | float] = []
        for part in parts:
            if (part.startswith("'") and part.endswith("'")) or (part.startswith('"') and part.endswith('"')):
                part = part[1:-1]
            cleaned.append(_coerce_scalar(part))
        return cleaned
    raise TypeError(f"unsupported value type for IN/NOT IN: {type(raw).__name__}")


class _ViewFilterBase(_ImmutableModel):
    source_ref: str
    column: str


class ComparisonViewFilter(_ViewFilterBase):
    operator: Literal["=", "!=", ">", ">=", "<", "<="]
    value: str | int | float

    @field_validator("value", mode="before")
    @classmethod
    def _coerce(cls, v: Any) -> Any:
        if v is None:
            raise ValueError("comparison operators require a value")
        return _coerce_scalar(v)


class LikeViewFilter(_ViewFilterBase):
    operator: Literal["LIKE", "NOT LIKE"]
    value: str

    @field_validator("value", mode="before")
    @classmethod
    def _require_str(cls, v: Any) -> Any:
        if v is None:
            raise ValueError("LIKE / NOT LIKE operators require a string value")
        return str(v)


class InViewFilter(_ViewFilterBase):
    operator: Literal["IN", "NOT IN"]
    value: list[str | int | float]

    @field_validator("value", mode="before")
    @classmethod
    def _coerce_list(cls, v: Any) -> Any:
        if v is None:
            raise ValueError("IN / NOT IN operators require a value")
        return _parse_list_value(v)


class NullViewFilter(_ViewFilterBase):
    operator: Literal["IS NULL", "IS NOT NULL"]
    value: None = None


ViewFilterVariant = Annotated[
    ComparisonViewFilter | LikeViewFilter | InViewFilter | NullViewFilter,
    Field(discriminator="operator"),
]

_VIEW_FILTER_ADAPTER: TypeAdapter[ViewFilterVariant] = TypeAdapter(ViewFilterVariant)


def parse_view_filter(data: dict[str, Any]) -> ViewFilterVariant:
    """Validate and parse a raw dict into the correct ViewFilter variant.

    Used at the use-case parsing boundary; routes by ``operator`` and applies
    the per-variant value coercion in a single step.
    """
    return _VIEW_FILTER_ADAPTER.validate_python(data)


def ViewFilter(
    *,
    source_ref: str,
    column: str,
    operator: str,
    value: Any = None,
) -> ViewFilterVariant:
    """Factory returning the appropriate discriminated-union variant.

    Preserves the calling convention of the legacy frozen-dataclass
    ``ViewFilter`` so existing test/production code that constructs it as
    ``ViewFilter(source_ref=..., column=..., operator=..., value=...)`` does
    not need to change. The actual returned instance is one of
    ``ComparisonViewFilter`` / ``LikeViewFilter`` / ``InViewFilter`` /
    ``NullViewFilter`` per the operator.
    """
    return parse_view_filter(
        {
            "source_ref": source_ref,
            "column": column,
            "operator": operator,
            "value": value,
        }
    )


# Identifier validation: SELECT/FROM/JOIN identifiers are double-quoted today;
# operators come from the discriminated union; the only remaining vector for
# malformed input pre-compiler is an unknown ``operator`` literal — caught by
# the Pydantic Literal type above, which surfaces a structured ValidationError
# whose ``loc`` points at the ``operator`` field.

ALLOWED_FILTER_OPERATORS: frozenset[str] = _ALLOWED_OPERATORS


# ---------------------------------------------------------------------------
# View aggregate
# ---------------------------------------------------------------------------


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
    filters: list[ViewFilterVariant] = field(default_factory=list)
    grain: ViewGrain | None = None
    description: str | None = None
    materialization: str = "ephemeral"
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_record(cls, record) -> View:
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
            parse_view_filter(
                {
                    "source_ref": f["source_ref"],
                    "column": f["column"],
                    "operator": f["operator"],
                    "value": f.get("value"),
                }
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
