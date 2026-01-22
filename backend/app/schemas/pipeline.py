"""Pydantic schemas for FilterPipeline."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class PipelineBase(BaseModel):
    """Base schema for FilterPipeline."""

    name: str
    description: str | None = None


class PipelineCreate(PipelineBase):
    """Schema for creating a FilterPipeline."""

    dataset_id: str
    raqb_json: dict[str, Any]
    nl_prompt: str | None = None


class PipelineUpdate(BaseModel):
    """Schema for updating a FilterPipeline."""

    name: str | None = None
    description: str | None = None
    raqb_json: dict[str, Any] | None = None


class PipelineResponse(PipelineBase):
    """Schema for FilterPipeline response."""

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


class PipelineExecuteRequest(BaseModel):
    """Schema for executing a pipeline."""

    limit: int | None = 100
    offset: int | None = 0


class PipelineExecuteResponse(BaseModel):
    """Schema for pipeline execution result."""

    pipeline_id: str
    input_row_count: int
    output_row_count: int
    execution_time_ms: float
    rows: list[dict[str, Any]]
