"""Pydantic schemas for Dataset and Transform."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator


class FieldConfig(BaseModel):
    """Configuration for a single field in the dataset schema."""

    label: str | None = None
    type: str  # "text", "number", "boolean", "datetime", "select"


class SchemaConfig(BaseModel):
    """Dataset schema configuration — basic field definitions."""

    fields: dict[str, FieldConfig]


class DatasetSparse(BaseModel):
    """Sparse dataset reference with schema summary."""

    id: str
    name: str
    link: str
    description: str | None = None
    schema_config: dict[str, Any]


class DatasetBase(BaseModel):
    """Base schema for Dataset."""

    name: str
    description: str | None = None


class DatasetCreate(BaseModel):
    """Schema for creating a Dataset from an upload.

    Step 2 of the upload flow: Only upload_id is required.
    Dataset name defaults to 'New Dataset' (business rule on domain model).
    """

    upload_id: str
    description: str | None = None
    partition_fields: list[str] = []


class DatasetUpdate(BaseModel):
    """Schema for updating a Dataset's metadata."""

    name: str | None = None
    description: str | None = None


class DatasetResponse(DatasetBase):
    """Schema for Dataset response.

    Can include transforms, preview_rows, and staging_sql when requested.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str  # UUID
    storage_path: str  # Parquet storage path
    project_id: str
    schema_config: dict[str, Any]
    partition_fields: list[str] = []  # Hive-style partition field names
    created_at: datetime
    updated_at: datetime

    # Optional nested data
    transforms: list[TransformResponse] = []
    preview_rows: list[dict[str, Any]] = []
    staging_sql: str | None = None  # Computed from transforms if included


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

    Cross-field validation rules by transform_type:
    - filter: requires condition_json + condition_sql; rejects expression fields
    - clean/alias/map: requires target_column + expression_config; rejects condition fields
    """

    condition_json: dict[str, Any] | None = None  # RAQB JSON tree (filter type)
    condition_sql: str | None = None  # SQL WHERE clause (filter type)
    nl_prompt: str | None = None
    transform_type: str = "filter"
    target_column: str | None = None
    expression_config: dict[str, Any] | None = None
    expression_sql: str | None = None  # Ignored on create — server-generated

    @model_validator(mode="after")
    def validate_cross_fields(self) -> TransformCreate:
        tt = self.transform_type

        if tt not in ("filter", "clean", "alias", "map"):
            raise ValueError(f"transform_type must be one of 'filter', 'clean', 'alias', 'map', got '{tt}'")

        if tt == "filter":
            if self.condition_json is None:
                raise ValueError("condition_json is required for transform_type 'filter'")
            if self.condition_sql is None:
                raise ValueError("condition_sql is required for transform_type 'filter'")
            if self.expression_config is not None:
                raise ValueError("expression_config must be null for transform_type 'filter'")
            if self.target_column is not None:
                raise ValueError("target_column must be null for transform_type 'filter'")
        else:
            # clean, alias, map
            if self.target_column is None:
                raise ValueError(f"target_column is required for transform_type '{tt}'")
            if self.expression_config is None:
                raise ValueError(f"expression_config is required for transform_type '{tt}'")
            if self.condition_json is not None:
                raise ValueError(f"condition_json must be null for transform_type '{tt}'")
            if self.condition_sql is not None:
                raise ValueError(f"condition_sql must be null for transform_type '{tt}'")

        return self


class TransformUpdate(BaseModel):
    """Schema for updating a Transform.

    When updating condition_json, condition_sql must also be provided.
    transform_type and target_column cannot be changed after creation.
    """

    name: str | None = None
    description: str | None = None
    condition_json: dict[str, Any] | None = None  # RAQB JSON tree
    condition_sql: str | None = None  # Must be provided if condition_json changes
    status: str | None = None  # 'enabled' | 'disabled' | 'deleted'
    expression_config: dict[str, Any] | None = None
    expression_sql: str | None = None


class TransformCreateBatch(BaseModel):
    """Request body for POST /datasets/:id/transforms — batch create."""

    transforms: list[TransformCreate]


class TransformUpdateItem(BaseModel):
    """A single item in a batch update."""

    id: str
    name: str | None = None
    description: str | None = None
    condition_json: dict[str, Any] | None = None
    condition_sql: str | None = None
    status: str | None = None  # 'enabled' | 'disabled' | 'deleted'
    expression_config: dict[str, Any] | None = None
    expression_sql: str | None = None


class TransformBatchUpdate(BaseModel):
    """Request body for PATCH /datasets/:id/transforms — batch update."""

    updates: list[TransformUpdateItem]


class TransformResponse(TransformBase):
    """Schema for Transform response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    condition_json: dict[str, Any] | None = None  # Was: raqb_json
    condition_sql: str | None = None  # Was: cached_sql
    version: int
    status: str  # 'enabled' | 'disabled' | 'deleted'
    nl_prompt: str | None = None
    created_at: datetime
    updated_at: datetime
    transform_type: str = "filter"
    target_column: str | None = None
    expression_config: dict[str, Any] | None = None
    expression_sql: str | None = None


# Note: AggregatedSqlResponse removed - use DatasetResponse.staging_sql instead


# Preview schemas


class PreviewRequest(BaseModel):
    """Request body for POST /datasets/:id/transforms/preview."""

    transform_type: str
    target_column: str
    expression_config: dict[str, Any]


class PreviewSample(BaseModel):
    """A single before/after sample pair."""

    before: Any
    after: Any


class PreviewResponse(BaseModel):
    """Response from the transform preview endpoint."""

    affected_count: int
    total_count: int
    samples: list[PreviewSample]
    column: str
    operation_description: str


# Upload Event schemas


class UploadEventResponse(BaseModel):
    """Schema for UploadEvent response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    dataset_id: str | None = None
    status: str  # pending | processing | completed | failed
    raw_storage_path: str
    original_filename: str
    file_size: int
    row_count: int
    error_message: str | None = None
    created_at: datetime
    processed_at: datetime | None = None
    preview_rows: list[dict[str, Any]] = []  # Optional, included on request
