"""Tests for CsvPlugin."""

import pytest

from app.plugins.csv_plugin import CsvPlugin
from app.plugins.protocol import PluginValidationError, ProcessingResult


class TestCsvPlugin:
    """Tests for CSV file processing plugin."""

    def setup_method(self):
        self.plugin = CsvPlugin()

    def test_valid_csv_returns_correct_dataframe(self):
        """process should parse valid CSV into a DataFrame with correct data."""
        content = b"name,age\nAlice,30\nBob,25\n"

        result = self.plugin.process(content, "data.csv")

        assert isinstance(result, ProcessingResult)
        assert list(result.df.columns) == ["name", "age"]
        assert len(result.df) == 2
        assert result.df["name"].tolist() == ["Alice", "Bob"]
        assert result.df["age"].tolist() == [30, 25]

    def test_empty_file_raises_validation_error(self):
        """validate should raise PluginValidationError for empty content."""
        with pytest.raises(PluginValidationError, match="File is empty"):
            self.plugin.validate(b"", "empty.csv")

    def test_headers_only_returns_zero_rows(self):
        """process should return a DataFrame with 0 rows when only headers are present."""
        content = b"name,age,city\n"

        result = self.plugin.process(content, "headers.csv")

        assert list(result.df.columns) == ["name", "age", "city"]
        assert len(result.df) == 0

    def test_whitespace_stripping_on_headers(self):
        """process should strip whitespace from column headers."""
        content = b" name , age \nAlice,30\n"

        result = self.plugin.process(content, "data.csv")

        assert list(result.df.columns) == ["name", "age"]

    def test_whitespace_stripping_on_values(self):
        """process should strip whitespace from string cell values."""
        content = b"name,city\n  Alice  ,  New York  \n"

        result = self.plugin.process(content, "data.csv")

        assert result.df["name"].iloc[0] == "Alice"
        assert result.df["city"].iloc[0] == "New York"

    def test_detect_choices_returns_none(self):
        """detect_choices should always return None for CSV files."""
        content = b"name,age\nAlice,30\n"

        assert self.plugin.detect_choices(content, "data.csv") is None

    def test_validate_accepts_non_empty_file(self):
        """validate should not raise for a non-empty file."""
        self.plugin.validate(b"name,age\n", "data.csv")

    def test_plugin_metadata(self):
        """CsvPlugin should expose correct name, extensions, and label."""
        assert self.plugin.name == "csv"
        assert self.plugin.extensions == [".csv"]
        assert self.plugin.label == "CSV"
        assert self.plugin.dbt_macros is None
