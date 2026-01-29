"""SQLAlchemy models and domain models.

Note: Dataset and Transform are now domain models in this module.
ORM models are DatasetRecord and TransformRecord in repositories/.
For backward compatibility, we export the ORM models with their old names.
"""

from .project import Project
from .pipeline_run import PipelineRun, RunStatus

# Import ORM records from repositories for backward compatibility
from ..repositories.dataset_record import DatasetRecord
from ..repositories.transform_record import TransformRecord

# Export ORM models with old names for backward compatibility
Dataset = DatasetRecord
Transform = TransformRecord

__all__ = ["Project", "Dataset", "Transform", "PipelineRun", "RunStatus", "DatasetRecord", "TransformRecord"]
