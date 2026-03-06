"""Shared fixtures for plugin tests."""

import pandas as pd

from app.plugins.protocol import ProcessingResult


class StubPlugin:
    """Minimal plugin that satisfies the FileFormatPlugin protocol."""

    name = "stub"
    extensions = [".stub"]
    label = "Stub"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        return ProcessingResult(df=pd.DataFrame())


class AnotherStubPlugin:
    """Second stub plugin with a different extension."""

    name = "another"
    extensions = [".other"]
    label = "Another"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        return ProcessingResult(df=pd.DataFrame())


class MultiExtPlugin:
    """Stub plugin that claims multiple extensions."""

    name = "multi"
    extensions = [".ext1", ".ext2"]
    label = "Multi"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        return ProcessingResult(df=pd.DataFrame())
