"""Pydantic schemas for Dataset."""

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
    """Schema for Dataset response."""

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


class DatasetUploadResponse(DatasetResponse):
    """Schema for Dataset upload response with preview."""

    preview_rows: list[dict[str, Any]] = []
