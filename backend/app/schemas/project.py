"""Pydantic schemas for Project."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

if TYPE_CHECKING:
    from .dataset import DatasetResponse


class ProjectBase(BaseModel):
    """Base schema for Project."""

    name: str
    description: str | None = None


class ProjectCreate(ProjectBase):
    """Schema for creating a Project."""

    pass


class ProjectUpdate(BaseModel):
    """Schema for updating a Project."""

    name: str | None = None
    description: str | None = None


class ProjectResponse(ProjectBase):
    """Schema for Project response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime


class ProjectWithDatasets(ProjectResponse):
    """Schema for Project with datasets."""

    datasets: list[DatasetResponse] = []
