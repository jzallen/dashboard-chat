"""Project domain model - authoritative business object.

This module contains the Project domain model for organizing datasets.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .dataset import Dataset


@dataclass(frozen=True, slots=True)
class Project:
    """Project domain model (authoritative business object).

    A project is a container for organizing related datasets.

    Attributes:
        id: Unique identifier (UUID)
        name: Human-readable project name
        description: Optional project description
        datasets: List of datasets belonging to this project
        created_at: When the project was created
        updated_at: When the project was last modified
    """

    id: str
    name: str
    description: str | None = None
    datasets: list[Dataset] = field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None

    def serialize(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict for HTTP responses."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "datasets": [d.serialize() for d in self.datasets] if self.datasets else [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
