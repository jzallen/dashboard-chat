"""Pydantic schemas."""

# Import dataset first since ProjectWithDatasets references DatasetResponse
from .dataset import (
    DatasetBase,
    DatasetCreate,
    DatasetUpdate,
    DatasetResponse,
    DatasetUploadResponse,
    FieldConfig,
    SchemaConfig,
    # Transform schemas (now in dataset.py)
    AggregatedSqlResponse,
    TransformBase,
    TransformCreate,
    TransformUpdate,
    TransformResponse,
)
from .project import (
    ProjectBase,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectWithDatasets,
)
from .pipeline_run import (
    PipelineRunBase,
    PipelineRunCreate,
    PipelineRunResponse,
)

# Rebuild models to resolve forward references
ProjectWithDatasets.model_rebuild()

__all__ = [
    # Project
    "ProjectBase",
    "ProjectCreate",
    "ProjectUpdate",
    "ProjectResponse",
    "ProjectWithDatasets",
    # Dataset
    "DatasetBase",
    "DatasetCreate",
    "DatasetUpdate",
    "DatasetResponse",
    "DatasetUploadResponse",
    "FieldConfig",
    "SchemaConfig",
    # Transform
    "AggregatedSqlResponse",
    "TransformBase",
    "TransformCreate",
    "TransformUpdate",
    "TransformResponse",
    # Pipeline Run (tech debt - unused but kept for future audit trail)
    "PipelineRunBase",
    "PipelineRunCreate",
    "PipelineRunResponse",
]
