"""Pydantic schemas for Transform."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class TransformBase(BaseModel):
    """Base schema for Transform."""

    name: str
    description: str | None = None


class TransformCreate(TransformBase):
    """Schema for creating a Transform."""

    dataset_id: str
    raqb_json: dict[str, Any]
    nl_prompt: str | None = None


class TransformUpdate(BaseModel):
    """Schema for updating a Transform."""

    name: str | None = None
    description: str | None = None
    raqb_json: dict[str, Any] | None = None
    is_active: bool | None = None


class TransformResponse(TransformBase):
    """Schema for Transform response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    raqb_json: dict[str, Any]
    cached_sql: str | None = None
    version: int
    is_active: bool
    nl_prompt: str | None = None
    created_at: datetime
    updated_at: datetime


class AggregatedSqlResponse(BaseModel):
    """Schema for aggregated SQL from active transforms."""

    dataset_id: str
    enabled_transform_count: int
    sql_where_clause: str
    transform_ids: list[str]
