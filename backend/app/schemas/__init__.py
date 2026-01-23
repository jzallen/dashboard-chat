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
)
from .project import (
    ProjectBase,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectWithDatasets,
)
from .pipeline import (
    AggregatedSqlResponse,
    PipelineBase,
    PipelineCreate,
    PipelineUpdate,
    PipelineResponse,
    PipelineExecuteRequest,
    PipelineExecuteResponse,
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
    # Pipeline
    "AggregatedSqlResponse",
    "PipelineBase",
    "PipelineCreate",
    "PipelineUpdate",
    "PipelineResponse",
    "PipelineExecuteRequest",
    "PipelineExecuteResponse",
    # Pipeline Run
    "PipelineRunBase",
    "PipelineRunCreate",
    "PipelineRunResponse",
]
