"""UploadEvent domain model - authoritative business object.

Represents a file upload event through its lifecycle:
- pending: File uploaded, awaiting user partition selection
- processing: Dataset creation in progress
- completed: Dataset created successfully
- failed: Processing failed
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class UploadEvent:
    """UploadEvent domain model (authoritative business object).

    Business rules:
    - Tracks file uploads through their lifecycle
    - Links to created dataset after processing
    """

    id: str
    project_id: str
    raw_storage_path: str
    original_filename: str
    file_size: int
    row_count: int = 0
    dataset_id: str | None = None
    status: str = "pending"
    error_message: str | None = None
    created_at: datetime | None = None
    processed_at: datetime | None = None
    preview_rows: list[dict[str, Any]] = field(default_factory=list)
