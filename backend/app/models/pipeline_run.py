"""PipelineRun domain model (tech debt - currently unused).

The ORM record lives in app/repositories/metadata/pipeline_run_record.py.
This is just the domain dataclass, mirroring the pattern of Transform/Dataset.
"""

from dataclasses import dataclass
from datetime import datetime


class RunStatus:
    """Transform run status constants (tech debt - currently unused)."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class PipelineRun:
    """PipelineRun domain model (tech debt - currently unused).

    The ORM record (PipelineRunRecord) handles persistence.
    """

    id: str
    pipeline_id: str
    status: str = RunStatus.PENDING
    input_row_count: int | None = None
    output_row_count: int | None = None
    execution_time_ms: float | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None
