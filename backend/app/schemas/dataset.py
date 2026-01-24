"""Pydantic schemas for Dataset and Transform."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class FieldConfig(BaseModel):
    """Configuration for a single field in the dataset schema."""

    label: str
    type: str  # "text", "number", "boolean", "datetime", "select", etc.
    operators: list[str] | None = None
    list_values: list[dict[str, str]] | None = None
    nullable: bool = True


class SchemaConfig(BaseModel):
    """Dataset schema configuration for RAQB."""

    fields: dict[str, FieldConfig]


class DatasetBase(BaseModel):
    """Base schema for Dataset."""

    name: str
    description: str | None = None


class DatasetCreate(DatasetBase):
    """Schema for creating a Dataset (without file upload)."""

    project_id: str


class DatasetUpdate(BaseModel):
    """Schema for updating a Dataset."""

    name: str | None = None
    description: str | None = None


class DatasetResponse(DatasetBase):
    """Schema for Dataset response.

    Can include transforms and preview_rows when requested.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    table_name: str
    schema_config: dict[str, Any]
    row_count: int
    file_name: str | None = None
    file_size: int | None = None
    created_at: datetime
    updated_at: datetime

    # Optional nested data
    transforms: list[TransformResponse] = []
    preview_rows: list[dict[str, Any]] = []


class DatasetUploadResponse(DatasetResponse):
    """Schema for Dataset upload response with preview."""

    preview_rows: list[dict[str, Any]] = []


# Transform schemas

class TransformBase(BaseModel):
    """Base schema for Transform."""

    name: str
    description: str | None = None


class TransformCreate(TransformBase):
    """Schema for creating a Transform.

    dataset_id will come from the URL path, not the request body.
    """

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
