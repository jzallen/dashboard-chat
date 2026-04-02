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
    plugin_name: str | None = None


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


@dataclass(frozen=True, slots=True)
class ProjectCreated:
    """A new project was created — triggers memory provisioning."""

    project_id: str
    org_id: str
    created_by: str


@dataclass(frozen=True, slots=True)
class DatasetSyncRequested:
    """Dataset sync requested — propagate view creation/update to query engine."""

    project_id: str
    dataset_id: str
    engine_node_id: str


@dataclass(frozen=True, slots=True)
class TransformSyncRequested:
    """Transform sync requested — propagate view update to query engine."""

    project_id: str
    dataset_id: str
    engine_node_id: str


@dataclass(frozen=True, slots=True)
class DatasetRemoved:
    """Dataset removed — propagate view deletion to query engine."""

    project_id: str
    dataset_id: str
    engine_node_id: str
    view_name: str


OutboxEvent = (
    UploadFileReceived
    | TransformsCreated
    | TransformsUpdated
    | ProjectCreated
    | DatasetSyncRequested
    | TransformSyncRequested
    | DatasetRemoved
)


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
        "ProjectCreated": ProjectCreated,
        "DatasetSyncRequested": DatasetSyncRequested,
        "TransformSyncRequested": TransformSyncRequested,
        "DatasetRemoved": DatasetRemoved,
    }
    event_class = event_registry[event_type]
    return event_class(**payload)
