"""Pydantic schemas for PipelineRun."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PipelineRunBase(BaseModel):
    """Base schema for PipelineRun."""

    pass


class PipelineRunCreate(PipelineRunBase):
    """Schema for creating a PipelineRun."""

    pipeline_id: str


class PipelineRunResponse(PipelineRunBase):
    """Schema for PipelineRun response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    pipeline_id: str
    status: str
    input_row_count: int | None = None
    output_row_count: int | None = None
    execution_time_ms: float | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
