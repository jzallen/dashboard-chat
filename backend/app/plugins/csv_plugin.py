"""CSV file format plugin — reference implementation."""

import io

import pandas as pd

from .protocol import PluginChoice, PluginValidationError, ProcessingResult


class CsvPlugin:
    """Plugin for CSV file processing.

    Extracted from the original parse_and_clean_csv() utility.
    """

    name = "csv"
    extensions = [".csv"]
    label = "CSV"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        if not file_content:
            raise PluginValidationError("File is empty")

    def detect_choices(self, file_content: bytes, filename: str) -> list[PluginChoice] | None:
        return None

    def process(
        self, file_content: bytes, filename: str, choices: dict[str, str] | None = None
    ) -> ProcessingResult:
        df = pd.read_csv(io.BytesIO(file_content))
        df.columns = df.columns.str.strip()
        str_cols = df.select_dtypes(include="object").columns
        df[str_cols] = df[str_cols].apply(lambda col: col.str.strip())
        return ProcessingResult(df=df)
