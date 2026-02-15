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
    TransformCreateBatch,
    TransformUpdate,
    TransformUpdateItem,
    TransformBatchUpdate,
    TransformResponse,
    # Preview schemas
    PreviewRequest,
    PreviewResponse,
    PreviewSample,
    # Upload event schemas
    UploadEventResponse,
)
from .project import (
    ProjectBase,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
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
    "TransformCreateBatch",
    "TransformUpdate",
    "TransformUpdateItem",
    "TransformBatchUpdate",
    "TransformResponse",
    # Preview
    "PreviewRequest",
    "PreviewResponse",
    "PreviewSample",
    # Upload Event
    "UploadEventResponse",
]
