"""Semantic manifest models aligned with dbt/MetricFlow conventions."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Column(BaseModel):
    id: str
    label: str
    type: Literal["string", "number", "date", "boolean"]
    description: str | None = None


class Metric(BaseModel):
    id: str
    label: str
    expression: str
    type: Literal["simple", "ratio", "cumulative", "derived"] = "simple"
    format: str | None = None


class Dimension(BaseModel):
    id: str
    label: str
    column_id: str
    type: Literal["categorical", "time"]
    time_granularity: Literal["day", "week", "month", "quarter", "year"] | None = None
    cardinality: Literal["low", "medium", "high"] | None = None


class Relationship(BaseModel):
    from_source: str
    to_source: str
    join_key: str
    type: Literal["one_to_many", "many_to_one", "one_to_one"] = "many_to_one"


class DataSource(BaseModel):
    id: str
    label: str
    columns: list[Column]


class SemanticManifest(BaseModel):
    data_sources: list[DataSource]
    metrics: list[Metric]
    dimensions: list[Dimension]
    relationships: list[Relationship] = Field(default_factory=list)
