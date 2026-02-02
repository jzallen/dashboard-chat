"""Domain events for the upload lifecycle.

These events represent state changes in the upload aggregate.
State is reconstructed by applying events in order.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class UploadFileReceived:
    """Initial upload event - file received and stored.

    Transitions upload to: pending
    """
    upload_id: str
    project_id: str
    raw_storage_path: str
    original_filename: str
    file_size: int
    row_count: int
    dataset_id: str | None = None
    timestamp: datetime = field(default_factory=datetime.utcnow)


@dataclass(frozen=True, slots=True)
class UploadProcessingStarted:
    """Processing has begun on the upload.

    Transitions upload to: processing
    """
    upload_id: str
    timestamp: datetime = field(default_factory=datetime.utcnow)


@dataclass(frozen=True, slots=True)
class UploadCompleted:
    """Upload successfully processed into a dataset.

    Transitions upload to: completed
    """
    upload_id: str
    dataset_id: str
    timestamp: datetime = field(default_factory=datetime.utcnow)


@dataclass(frozen=True, slots=True)
class UploadFailed:
    """Upload processing failed.

    Transitions upload to: failed
    """
    upload_id: str
    error_message: str
    timestamp: datetime = field(default_factory=datetime.utcnow)


# Type alias for all upload domain events
UploadDomainEvent = UploadFileReceived | UploadProcessingStarted | UploadCompleted | UploadFailed

# Registry mapping event type names to classes
EVENT_REGISTRY: dict[str, type[UploadDomainEvent]] = {
    "UploadFileReceived": UploadFileReceived,
    "UploadProcessingStarted": UploadProcessingStarted,
    "UploadCompleted": UploadCompleted,
    "UploadFailed": UploadFailed,
}


def to_domain_event(event_type: str, payload: dict[str, Any]) -> UploadDomainEvent:
    """Convert stored event data back to a domain event.

    Args:
        event_type: The event class name (e.g., "UploadFileReceived")
        payload: The event payload dict

    Returns:
        Reconstructed domain event instance

    Raises:
        KeyError: If event_type is not in the registry
    """
    event_class = EVENT_REGISTRY[event_type]

    # Handle timestamp conversion if stored as string
    if "timestamp" in payload and isinstance(payload["timestamp"], str):
        payload = {**payload, "timestamp": datetime.fromisoformat(payload["timestamp"])}

    return event_class(**payload)
