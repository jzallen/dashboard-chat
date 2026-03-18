"""Tests for MultiProcessingResult validation."""

import pandas as pd
import pytest

from app.plugins.protocol import MultiProcessingResult, ProcessingResult


class TestMultiProcessingResult:
    """Tests for MultiProcessingResult dataclass validation."""

    def test_valid_construction(self):
        """MultiProcessingResult should accept a list of named ProcessingResults."""
        results = [
            ProcessingResult(df=pd.DataFrame({"id": [1]}), name="Patient"),
            ProcessingResult(df=pd.DataFrame({"id": [2]}), name="Observation"),
        ]
        multi = MultiProcessingResult(results=results)

        assert len(multi.results) == 2
        assert multi.results[0].name == "Patient"
        assert multi.results[1].name == "Observation"
        assert multi.chat_guidance is None

    def test_valid_with_chat_guidance(self):
        """MultiProcessingResult should accept optional chat_guidance."""
        results = [ProcessingResult(df=pd.DataFrame({"id": [1]}), name="Patient")]
        multi = MultiProcessingResult(results=results, chat_guidance="Contains Patient resources")

        assert multi.chat_guidance == "Contains Patient resources"

    def test_empty_results_raises(self):
        """MultiProcessingResult should reject empty results list."""
        with pytest.raises(ValueError, match="at least one result"):
            MultiProcessingResult(results=[])

    def test_unnamed_item_raises(self):
        """MultiProcessingResult should reject items without a name."""
        results = [
            ProcessingResult(df=pd.DataFrame({"id": [1]}), name="Patient"),
            ProcessingResult(df=pd.DataFrame({"id": [2]})),  # no name
        ]
        with pytest.raises(ValueError, match="item 1 is unnamed"):
            MultiProcessingResult(results=results)

    def test_single_unnamed_item_raises(self):
        """MultiProcessingResult should reject a single unnamed item."""
        results = [ProcessingResult(df=pd.DataFrame({"id": [1]}))]
        with pytest.raises(ValueError, match="item 0 is unnamed"):
            MultiProcessingResult(results=results)


class TestProcessingResultNameField:
    """Tests for the name field on ProcessingResult."""

    def test_name_defaults_to_none(self):
        """ProcessingResult.name should default to None."""
        result = ProcessingResult(df=pd.DataFrame())
        assert result.name is None

    def test_name_can_be_set(self):
        """ProcessingResult.name should accept a string value."""
        result = ProcessingResult(df=pd.DataFrame(), name="Patient")
        assert result.name == "Patient"
