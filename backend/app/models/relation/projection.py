"""Typed projection kernel for relation columns.

A relation's projected columns carry a ``semantic_role`` (entity / dimension /
measure) that fixes which ``semantic_type`` values are legal and, for time
dimensions, whether a ``time_granularity`` is required. This module lifts that
dict-soup onto a Pydantic discriminated union over ``semantic_role`` — mirroring
``ViewFilterVariant``'s discriminated union over ``operator`` in
``app.models.view`` — so a malformed column is rejected at the parsing boundary
rather than by a free function reached at render time.

``EntityColumn`` and ``DimensionColumn`` are non-aggregating projections;
``Measure`` is the aggregating arm. ``ProjectionColumn`` is the union routed by
``semantic_role``; ``hydrate_projection_columns`` validates a raw
``columns_metadata`` list into typed instances.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

TIME_GRANULARITIES = Literal["day", "week", "month", "quarter", "year"]


class _ProjectionColumnBase(BaseModel):
    """Shared identity of a projected column.

    ``extra="allow"`` keeps unknown presentation keys that ride along in
    production ``columns_metadata`` payloads (e.g. ``source_column``,
    ``source_ref``) without forcing every caller to enumerate them here — the
    kernel's job is to enforce the role/type contract, not to freeze the whole
    presentation surface.
    """

    model_config = ConfigDict(frozen=True, extra="allow")

    name: str


class EntityColumn(_ProjectionColumnBase):
    """A key column identifying the grain's entities."""

    semantic_role: Literal["entity"]
    semantic_type: Literal["primary", "foreign", "unique"]


class DimensionColumn(_ProjectionColumnBase):
    """A grouping column; ``time`` dimensions carry a granularity."""

    semantic_role: Literal["dimension"]
    semantic_type: Literal["categorical", "time"]
    time_granularity: TIME_GRANULARITIES | None = None

    @model_validator(mode="after")
    def _time_requires_granularity(self) -> DimensionColumn:
        if self.semantic_type == "time" and self.time_granularity is None:
            raise ValueError("time dimension requires a time_granularity")
        return self


class Measure(_ProjectionColumnBase):
    """An aggregating column bound to an aggregation function."""

    semantic_role: Literal["measure"]
    semantic_type: Literal["sum", "count", "count_distinct", "avg", "min", "max"]


ProjectionColumn = Annotated[
    EntityColumn | DimensionColumn | Measure,
    Field(discriminator="semantic_role"),
]

_PROJECTION_COLUMNS_ADAPTER: TypeAdapter[list[ProjectionColumn]] = TypeAdapter(list[ProjectionColumn])


def hydrate_projection_columns(columns_metadata: list[dict]) -> list[ProjectionColumn]:
    """Validate raw column metadata into typed projection-kernel instances.

    Routes each column by ``semantic_role`` through the discriminated union,
    enforcing the legal ``semantic_type`` set per role and the time-granularity
    requirement. Raises ``pydantic.ValidationError`` on any malformed column.
    """
    return _PROJECTION_COLUMNS_ADAPTER.validate_python(columns_metadata)
