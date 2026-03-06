"""Shared fixtures for plugin tests."""

from typing import ClassVar

import pandas as pd

from app.plugins.protocol import ProcessingResult


class StubPlugin:
    """Minimal plugin that satisfies the FileFormatPlugin protocol."""

    name: ClassVar[str] = "stub"
    extensions: ClassVar[list[str]] = [".stub"]
    label: ClassVar[str] = "Stub"
    dbt_macros: ClassVar[dict[str, str] | None] = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        return ProcessingResult(df=pd.DataFrame())


class AnotherStubPlugin:
    """Second stub plugin with a different extension."""

    name: ClassVar[str] = "another"
    extensions: ClassVar[list[str]] = [".other"]
    label: ClassVar[str] = "Another"
    dbt_macros: ClassVar[dict[str, str] | None] = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        return ProcessingResult(df=pd.DataFrame())


class MultiExtPlugin:
    """Stub plugin that claims multiple extensions."""

    name: ClassVar[str] = "multi"
    extensions: ClassVar[list[str]] = [".ext1", ".ext2"]
    label: ClassVar[str] = "Multi"
    dbt_macros: ClassVar[dict[str, str] | None] = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        return ProcessingResult(df=pd.DataFrame())
