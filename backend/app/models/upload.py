"""UploadEvent domain model - authoritative business object.

Represents a file upload event through its lifecycle:
- pending: File uploaded, awaiting user partition selection
- processing: Dataset creation in progress
- completed: Dataset created successfully
- failed: Processing failed
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.repositories.outbox.outbox_record import OutboxRecord


@dataclass(frozen=True, slots=True)
class Upload:
    """Upload domain model (authoritative business object).

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
    dataset_ids: list[str] = field(default_factory=list)
    converted_storage_path: str | None = None
    status: str = "pending"
    error_message: str | None = None
    created_at: datetime | None = None
    processed_at: datetime | None = None
    preview_rows: list[dict[str, Any]] = field(default_factory=list)
    choices: list[dict[str, Any]] | None = None

    @classmethod
    def from_outbox_record(cls, record: OutboxRecord, preview_rows: list[dict[str, Any]] | None = None) -> Upload:
        """Create an UploadEvent from an OutboxRecord."""
        payload = record.payload
        return cls(
            id=record.id,
            project_id=payload["project_id"],
            dataset_id=payload.get("dataset_id"),
            dataset_ids=payload.get("dataset_ids") or [],
            converted_storage_path=payload.get("converted_storage_path"),
            raw_storage_path=payload["raw_storage_path"],
            original_filename=payload["original_filename"],
            file_size=payload["file_size"],
            created_at=record.created_at,
            preview_rows=preview_rows or [],
        )

    def serialize(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict for HTTP responses."""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "dataset_id": self.dataset_id,
            "dataset_ids": self.dataset_ids,
            "converted_storage_path": self.converted_storage_path,
            "status": self.status,
            "raw_storage_path": self.raw_storage_path,
            "original_filename": self.original_filename,
            "file_size": self.file_size,
            "row_count": self.row_count,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "processed_at": self.processed_at.isoformat() if self.processed_at else None,
            "preview_rows": self.preview_rows,
            "choices": self.choices,
        }
