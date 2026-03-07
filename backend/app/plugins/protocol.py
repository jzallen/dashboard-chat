"""Plugin protocol and data types for file format processing."""

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import pandas as pd

from app.use_cases.exceptions import DomainException


class PluginValidationError(DomainException):
    """Raised when a plugin rejects a file during validation."""

    _type = "PLUGIN_VALIDATION_ERROR"
    _title = "File Validation Failed"
    _status_code = 400

    def __init__(self, message: str):
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class PluginChoice:
    """A choice the user must make before processing can continue."""

    key: str  # e.g., "sheet_name", "resource_type"
    label: str  # "Select a sheet to import"
    options: list[str]  # ["Sheet1", "Sheet2", "Sheet3"]


@dataclass(slots=True)
class ProcessingResult:
    """Result returned by a plugin's process() method."""

    df: pd.DataFrame
    schema_hints: dict[str, str] | None = None
    default_transforms: list[dict] | None = None
    dbt_macros: dict[str, str] | None = None
    chat_guidance: str | None = None
    name: str | None = None


@dataclass(slots=True)
class MultiProcessingResult:
    """Result for plugins that produce multiple datasets from a single upload."""

    results: list[ProcessingResult]
    chat_guidance: str | None = None

    def __post_init__(self) -> None:
        if not self.results:
            raise ValueError("MultiProcessingResult requires at least one result")
        for i, r in enumerate(self.results):
            if r.name is None:
                raise ValueError(f"All items in MultiProcessingResult must have a name (item {i} is unnamed)")


@runtime_checkable
class FileFormatPlugin(Protocol):
    """Protocol for file format plugins.

    Plugins are pure data processors: they receive file bytes and return
    a pandas DataFrame. They do NOT receive platform services.
    """

    name: str
    extensions: list[str]
    label: str
    dbt_macros: dict[str, str] | None

    def validate(self, file_content: bytes, filename: str) -> None:
        """Raise PluginValidationError if the file is invalid."""
        ...

    def detect_choices(self, file_content: bytes, filename: str) -> list[PluginChoice] | None:
        """Return choices the user must make, or None if processing can proceed directly."""
        ...

    def process(
        self, file_content: bytes, filename: str, choices: dict[str, str] | None = None
    ) -> ProcessingResult | MultiProcessingResult:
        """Convert file bytes to tabular data."""
        ...
