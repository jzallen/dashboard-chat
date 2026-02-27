"""Event utilities for outbox pattern.

Provides event type mappings and conversion utilities
for reconstructing domain events from OutboxRecords.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class UploadFileReceived:
    """Initial upload event - file received and stored.

    Transitions upload to: pending
    """

    project_id: str
    raw_storage_path: str
    original_filename: str
    file_size: int
    dataset_id: str | None = None


@dataclass(frozen=True, slots=True)
class TransformsCreated:
    """One or more transforms created on a dataset."""

    dataset_id: str
    transforms: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class TransformsUpdated:
    """One or more transforms updated (including soft-delete via status='deleted')."""

    dataset_id: str
    changes: list[dict[str, Any]]


OutboxEvent = UploadFileReceived | TransformsCreated | TransformsUpdated


def to_event(event_type: str, payload: dict[str, Any]) -> OutboxEvent:
    """Convert stored event data back to a domain event.

    Args:
        event_type: The event class name (e.g., "UploadFileReceived")
        payload: The event payload dict

    Returns:
        Reconstructed domain event instance

    Raises:
        KeyError: If event_type is not in the registry
    """
    event_registry = {
        "UploadFileReceived": UploadFileReceived,
        "TransformsCreated": TransformsCreated,
        "TransformsUpdated": TransformsUpdated,
    }
    event_class = event_registry[event_type]
    return event_class(**payload)
