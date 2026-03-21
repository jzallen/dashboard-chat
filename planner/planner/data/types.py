"""Data query types aligned with MetricFlow semantics."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SemanticQuery(BaseModel):
    metrics: list[str]
    group_by: list[str] = Field(default_factory=list)
    where: list[str] = Field(default_factory=list)
    order_by: list[str] = Field(default_factory=list)
    limit: int | None = None


class ColumnMetadata(BaseModel):
    name: str
    type: Literal["metric", "dimension", "time_dimension"]
    data_type: Literal["string", "number", "date", "boolean"]


class SemanticQueryResult(BaseModel):
    columns: list[ColumnMetadata]
    rows: list[dict]
    generated_sql: str | None = None
