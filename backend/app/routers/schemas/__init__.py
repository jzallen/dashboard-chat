"""Pydantic schemas."""

# Import dataset first since ProjectWithDatasets references DatasetResponse
from .dataset import (
    DatasetBase,
    DatasetCreate,
    DatasetResponse,
    DatasetSparse,
    DatasetUpdate,
    DatasetUploadResponse,
    FieldConfig,
    # Preview schemas
    PreviewRequest,
    PreviewResponse,
    PreviewSample,
    SchemaConfig,
    # Transform schemas (now in dataset.py)
    TransformBase,
    TransformBatchUpdate,
    TransformCreate,
    TransformCreateBatch,
    TransformResponse,
    TransformUpdate,
    TransformUpdateItem,
    # Upload event schemas
    UploadEventResponse,
)
from .project import (
    ProjectBase,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
)
from .session import (
    SessionUpdate,
)

# Rebuild models to resolve forward references
ProjectResponse.model_rebuild()

__all__ = [
    "DatasetBase",
    "DatasetCreate",
    "DatasetResponse",
    "DatasetSparse",
    "DatasetUpdate",
    "DatasetUploadResponse",
    "FieldConfig",
    "PreviewRequest",
    "PreviewResponse",
    "PreviewSample",
    "ProjectBase",
    "ProjectCreate",
    "ProjectResponse",
    "ProjectUpdate",
    "SchemaConfig",
    "SessionUpdate",
    "TransformBase",
    "TransformBatchUpdate",
    "TransformCreate",
    "TransformCreateBatch",
    "TransformResponse",
    "TransformUpdate",
    "TransformUpdateItem",
    "UploadEventResponse",
]
