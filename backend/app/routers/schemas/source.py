"""Pydantic schemas for Source (inbound boundary validation)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SourceCreate(BaseModel):
    """Schema for creating a Source."""

    project_id: str
    name: str
    schema_config: dict[str, Any] | None = Field(default=None)


class RecordUpload(BaseModel):
    """Schema for recording an upload (mints a presigned PUT URL)."""

    filename: str
    content_type: str
    size: int


class ProcessUpload(BaseModel):
    """Schema for UI-triggered ingestion of a recorded upload.

    ``choices`` resolves an ``awaiting_input`` step (e.g. sheet selection).
    """

    choices: dict[str, str] | None = Field(default=None)
