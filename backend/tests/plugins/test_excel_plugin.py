"""Tests for the Excel file format plugin."""

import io

import pytest
from openpyxl import Workbook

from app.plugins.excel_plugin import ExcelPlugin
from app.plugins.protocol import PluginValidationError


def make_excel(sheets: dict[str, list[list]]) -> bytes:
    """Create an in-memory Excel file from a dict of sheet_name -> rows."""
    wb = Workbook()
    first = True
    for name, rows in sheets.items():
        ws = wb.active if first else wb.create_sheet(name)
        if first:
            ws.title = name
            first = False
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def plugin():
    return ExcelPlugin()


@pytest.fixture
def single_sheet_bytes():
    return make_excel(
        {
            "Data": [
                ["name", "age", "city"],
                ["Alice", 30, "New York"],
                ["Bob", 25, "London"],
            ]
        }
    )


@pytest.fixture
def multi_sheet_bytes():
    return make_excel(
        {
            "Sales": [
                ["product", "revenue"],
                ["Widget", 100],
                ["Gadget", 200],
            ],
            "Costs": [
                ["item", "amount"],
                ["Rent", 500],
                ["Wages", 1000],
            ],
        }
    )


class TestValidate:
    def test_valid_file_passes(self, plugin, single_sheet_bytes):
        # Should not raise
        plugin.validate(single_sheet_bytes, "data.xlsx")

    def test_empty_file_raises(self, plugin):
        with pytest.raises(PluginValidationError, match="File is empty"):
            plugin.validate(b"", "empty.xlsx")

    def test_corrupt_file_raises(self, plugin):
        with pytest.raises(PluginValidationError, match="Invalid Excel file"):
            plugin.validate(b"this is not an excel file", "bad.xlsx")


class TestDetectChoices:
    def test_single_sheet_returns_none(self, plugin, single_sheet_bytes):
        result = plugin.detect_choices(single_sheet_bytes, "data.xlsx")
        assert result is None

    def test_multi_sheet_returns_choices(self, plugin, multi_sheet_bytes):
        result = plugin.detect_choices(multi_sheet_bytes, "report.xlsx")
        assert result is not None
        assert len(result) == 1
        choice = result[0]
        assert choice.key == "sheet_name"
        assert choice.label == "Select a sheet to import"
        assert choice.options == ["Sales", "Costs"]


class TestProcess:
    def test_single_sheet_returns_dataframe(self, plugin, single_sheet_bytes):
        result = plugin.process(single_sheet_bytes, "data.xlsx")
        assert list(result.df.columns) == ["name", "age", "city"]
        assert len(result.df) == 2
        assert result.df.iloc[0]["name"] == "Alice"
        assert result.df.iloc[1]["age"] == 25

    def test_multi_sheet_with_choice(self, plugin, multi_sheet_bytes):
        result = plugin.process(multi_sheet_bytes, "report.xlsx", choices={"sheet_name": "Costs"})
        assert list(result.df.columns) == ["item", "amount"]
        assert len(result.df) == 2
        assert result.df.iloc[0]["item"] == "Rent"

    def test_multi_sheet_without_choice_uses_first(self, plugin, multi_sheet_bytes):
        result = plugin.process(multi_sheet_bytes, "report.xlsx")
        assert list(result.df.columns) == ["product", "revenue"]
        assert len(result.df) == 2

    def test_invalid_sheet_name_raises(self, plugin, single_sheet_bytes):
        with pytest.raises(PluginValidationError, match="Invalid sheet name"):
            plugin.process(single_sheet_bytes, "data.xlsx", choices={"sheet_name": "NonExistent"})

    def test_strips_whitespace_from_headers(self, plugin):
        content = make_excel(
            {
                "Sheet1": [
                    ["  name  ", " age "],
                    ["Alice", 30],
                ]
            }
        )
        result = plugin.process(content, "data.xlsx")
        assert list(result.df.columns) == ["name", "age"]

    def test_strips_whitespace_from_string_columns(self, plugin):
        content = make_excel(
            {
                "Sheet1": [
                    ["name", "city"],
                    ["  Alice  ", "  New York  "],
                ]
            }
        )
        result = plugin.process(content, "data.xlsx")
        assert result.df.iloc[0]["name"] == "Alice"
        assert result.df.iloc[0]["city"] == "New York"
