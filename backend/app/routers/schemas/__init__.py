"""Pydantic schemas."""

# Import dataset first since ProjectWithDatasets references DatasetResponse
from .dataset import (
    DatasetBase,
    DatasetCreate,
    DatasetSparse,
    DatasetUpdate,
    DatasetResponse,
    DatasetUploadResponse,
    FieldConfig,
    SchemaConfig,
    # Transform schemas (now in dataset.py)
    TransformBase,
    TransformCreate,
    TransformInput,
    TransformUpdate,
    TransformResponse,
    # Upload event schemas
    UploadEventResponse,
)
from .project import (
    ProjectBase,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
)
from .pipeline_run import (
    PipelineRunBase,
    PipelineRunCreate,
    PipelineRunResponse,
)

# Rebuild models to resolve forward references
ProjectResponse.model_rebuild()

__all__ = [
    # Project
    "ProjectBase",
    "ProjectCreate",
    "ProjectUpdate",
    "ProjectResponse",
    # Dataset
    "DatasetBase",
    "DatasetCreate",
    "DatasetSparse",
    "DatasetUpdate",
    "DatasetResponse",
    "DatasetUploadResponse",
    "FieldConfig",
    "SchemaConfig",
    # Transform
    "TransformBase",
    "TransformCreate",
    "TransformInput",
    "TransformUpdate",
    "TransformResponse",
    # Upload Event
    "UploadEventResponse",
    # Pipeline Run (tech debt - unused but kept for future audit trail)
    "PipelineRunBase",
    "PipelineRunCreate",
    "PipelineRunResponse",
]
