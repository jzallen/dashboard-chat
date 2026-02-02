"""Domain models - authoritative business objects.

Domain models are frozen dataclasses in this module.
ORM models (ProjectRecord, DatasetRecord, TransformRecord) are in repositories/.
"""

from .project import Project
from .dataset import Dataset
from .transform import Transform
from .pipeline_run import PipelineRun, RunStatus
from .upload_event import UploadEvent
from .upload_domain_events import (
    UploadFileReceived,
    UploadProcessingStarted,
    UploadCompleted,
    UploadFailed,
    UploadDomainEvent,
    EVENT_REGISTRY,
    to_domain_event,
)

__all__ = [
    "Project",
    "Dataset",
    "Transform",
    "PipelineRun",
    "RunStatus",
    "UploadEvent",
    "UploadFileReceived",
    "UploadProcessingStarted",
    "UploadCompleted",
    "UploadFailed",
    "UploadDomainEvent",
    "EVENT_REGISTRY",
    "to_domain_event",
]
